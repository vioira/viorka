package monitoring

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"sync"
	"time"

	v1 "github.com/vioira/viorka/protocol/v1"
)

var ErrPartitionClockRollback = errors.New("history clock precedes established partition")

var ErrTelemetryOverloaded = errors.New("telemetry history budget exceeded")
var ErrTelemetryRun = errors.New("telemetry run is not active")

const telemetryPendingBudget = 32 << 20 // leaves room for snapshots and bounded I/O buffers

type TelemetryRepository interface {
	SaveTelemetryHistory(context.Context, []NodeHistory, time.Time) error
	RestoreTelemetryHistory(context.Context, time.Time) ([]NodeHistory, error)
	RotateTelemetryHistory(context.Context, time.Time) error
}
type telemetryNode struct {
	data             NodeHistory
	activeRun        string
	version          uint64
	dirty            bool
	persistedVersion uint64
	bucketVersions   map[int64]uint64
	bytes            int
}

// TelemetryRecorder owns deduplication and typed bucket state in one Panel
// process. Admission is all-or-nothing and flushes serialize independently of
// ingestion. Callers must structurally validate the whole batch first.
type TelemetryRecorder struct {
	mu           sync.Mutex
	flushMu      sync.Mutex
	repo         TelemetryRepository
	nodes        map[string]*telemetryNode
	bytes        int
	retryAt      time.Time
	failures     int
	expiredDirty uint64
	flushAfter   string
	diagnostics  telemetryRecorderDiagnostics
}

func NewTelemetryRecorder(ctx context.Context, repo TelemetryRepository, now time.Time) (*TelemetryRecorder, error) {
	rotationErr := repo.RotateTelemetryHistory(ctx, now)
	if err := rotationErr; err != nil {
		if !errors.Is(err, ErrPartitionClockRollback) {
			return nil, err
		}
		slog.Warn("history clock precedes established partition; keeping existing partitions")
	}
	saved, err := repo.RestoreTelemetryHistory(ctx, now)
	if err != nil {
		return nil, err
	}
	r := &TelemetryRecorder{repo: repo, nodes: map[string]*telemetryNode{}}
	for _, n := range saved {
		if _, ok := r.nodes[n.Node]; ok || len(r.nodes) >= MaxNodes {
			return nil, ErrTelemetryOverloaded
		}
		size := historyMemory(n)
		r.bytes += size
		if r.bytes > telemetryPendingBudget {
			return nil, ErrTelemetryOverloaded
		}
		r.nodes[n.Node] = &telemetryNode{data: n, bytes: size}
	}
	r.diagnostics.initialized = now
	r.diagnostics.rotationAttempt = now
	r.diagnostics.rotationError = rotationErr != nil
	if rotationErr == nil {
		r.diagnostics.rotationSuccess = now
	}
	return r, nil
}
func historyMemory(n NodeHistory) int {
	// Conservative allocation accounting, including pointer targets, slice spare
	// capacity and strings. Pending copies are separately capped by flush budgets.
	size := 1024 + 2*len(n.Node) + len(n.Checkpoints)*512
	for _, b := range n.Buckets {
		size += 2048 + 2*(len(b.Node)+len(b.FilterRevision)+len(b.TrafficFilterRevision))
	}
	if n.System != nil {
		size += 1024 + 2*(len(n.System.OSID)+len(n.System.OSName)+len(n.System.OSVersion))
	}
	size += len(n.Addresses) * 256
	return size
}
func cloneHistory(n NodeHistory) NodeHistory {
	n.Buckets = append([]Bucket(nil), n.Buckets...)
	n.Checkpoints = append([]Checkpoint(nil), n.Checkpoints...)
	n.Addresses = append([]AddressSnapshot(nil), n.Addresses...)
	return n
}

// BindRun is called only by the authenticated ready exchange. A superseded run
// loses upload permission immediately, even if its checkpoints remain cached.
func (r *TelemetryRecorder) BindRun(node, run string, now time.Time) error {
	if node == "" || len(node) > 128 || run == "" || len(run) > 128 {
		return ErrTelemetryRun
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	n := r.nodes[node]
	if n == nil {
		if len(r.nodes) >= MaxNodes || r.bytes+2048 > telemetryPendingBudget {
			return ErrTelemetryOverloaded
		}
		n = &telemetryNode{data: NodeHistory{Node: node}}
		n.bytes = historyMemory(n.data)
		r.bytes += n.bytes
		r.nodes[node] = n
	}
	runs := map[string]bool{run: true}
	for _, c := range n.data.Checkpoints {
		if c.SampledAt >= now.Add(-10*time.Minute).UnixMilli() || c.RunID == n.activeRun {
			runs[c.RunID] = true
		}
	}
	if len(runs) > 4 {
		return ErrTelemetryOverloaded
	}
	n.activeRun = run
	return nil
}
func findCheckpoint(n *NodeHistory, run, group string) *Checkpoint {
	for i := range n.Checkpoints {
		c := &n.Checkpoints[i]
		if c.RunID == run && c.Group == group {
			return c
		}
	}
	n.Checkpoints = append(n.Checkpoints, Checkpoint{RunID: run, Group: group})
	return &n.Checkpoints[len(n.Checkpoints)-1]
}
func findBucket(n *NodeHistory, at time.Time) *Bucket {
	start := at.UTC().Truncate(30 * time.Second).Unix()
	for i := range n.Buckets {
		if n.Buckets[i].Start == start {
			return &n.Buckets[i]
		}
	}
	n.Buckets = append(n.Buckets, NewBucket(n.Node, at))
	return &n.Buckets[len(n.Buckets)-1]
}

// Accept does not validate authorization or structural field constraints; those
// are the shared P2 ingress service's responsibility, before calling this method.
func (r *TelemetryRecorder) Accept(batch v1.TelemetryBatch, now time.Time, reportSeconds uint64) (v1.TelemetryReceipt, error) {
	reply := v1.TelemetryReceipt{BatchID: batch.BatchID, State: "rejected", ErrorCode: "invalid_batch"}
	if err := batch.ValidateIdentity(batch.NodeID, now, reportSeconds); err != nil {
		return reply, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	n := r.nodes[batch.NodeID]
	if n == nil || n.activeRun != batch.RunID {
		reply.ErrorCode = "stale_session"
		return reply, ErrTelemetryRun
	}
	next := cloneHistory(n.data)
	// Remove only expired, inactive run checkpoints. Active runs retain their
	// watermarks through idle periods, avoiding replay after quiet intervals.
	checkpoints := next.Checkpoints[:0]
	for _, c := range next.Checkpoints {
		if c.RunID == n.activeRun || c.SampledAt >= now.Add(-10*time.Minute).UnixMilli() {
			checkpoints = append(checkpoints, c)
		}
	}
	next.Checkpoints = checkpoints
	var accepted, duplicates uint64
	touched := map[int64]bool{}
	admit := func(group string, seq uint64, at time.Time) bool {
		c := findCheckpoint(&next, batch.RunID, group)
		if seq <= c.Sequence {
			duplicates++
			return false
		}
		c.Sequence = seq
		c.SampledAt = at.UnixMilli()
		accepted++
		if group == "fast" || group == "full" {
			touched[at.UTC().Truncate(30*time.Second).Unix()] = true
		}
		return true
	}
	for _, f := range batch.Fast {
		if admit("fast", f.Sequence, f.SampledAt) {
			if err := findBucket(&next, f.SampledAt).AddFast(f); err != nil {
				return reply, err
			}
		}
	}
	for _, f := range batch.Full {
		if !admit("full", f.Sequence, f.SampledAt) {
			continue
		}
		if err := findBucket(&next, f.SampledAt).AddFull(f); err != nil {
			return reply, err
		}
		if next.System == nil || f.SampledAt.UnixMilli() >= next.System.SampledAt {
			unavailable := false
			for _, e := range f.Errors {
				if e == "os_unavailable" || e == "unsupported_platform" {
					unavailable = true
				}
			}
			next.System = &SystemSnapshot{OSID: f.OSID, OSName: f.OSName, OSVersion: f.OSVersion, SampledAt: f.SampledAt.UnixMilli(), Unavailable: unavailable}
		}
	}
	for _, ip := range batch.PublicIp {
		if !admit("public_ip", ip.Sequence, ip.SampledAt) {
			continue
		}
		for _, family := range []int{4, 6} {
			address := ip.Ipv4
			if family == 6 {
				address = ip.Ipv6
			}
			v := AddressSnapshot{Family: family, Address: address, SampledAt: ip.SampledAt.UnixMilli(), Unavailable: address == ""}
			found := false
			for i, old := range next.Addresses {
				if old.Family == family {
					found = true
					if v.SampledAt >= old.SampledAt {
						next.Addresses[i] = v
					}
					break
				}
			}
			if !found {
				next.Addresses = append(next.Addresses, v)
			}
		}
	}
	size := historyMemory(next)
	if r.bytes-n.bytes+size > telemetryPendingBudget || size > 4<<20 {
		reply.ErrorCode = "overloaded"
		return reply, ErrTelemetryOverloaded
	}
	if accepted > 0 {
		r.bytes += size - n.bytes
		n.bytes = size
		n.data = next
		n.version++
		if n.bucketVersions == nil {
			n.bucketVersions = map[int64]uint64{}
		}
		for start := range touched {
			n.bucketVersions[start] = n.version
		}
		n.dirty = true
		r.diagnostics.lastAccept = now
	}
	return v1.TelemetryReceipt{BatchID: batch.BatchID, State: "accepted", AcceptedCount: accepted, DuplicateCount: duplicates}, nil
}
func (r *TelemetryRecorder) Forget(node string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if n := r.nodes[node]; n != nil {
		r.bytes -= n.bytes
		delete(r.nodes, node)
	}
}
func (r *TelemetryRecorder) Flush(ctx context.Context, now time.Time, force bool) error {
	r.flushMu.Lock()
	defer r.flushMu.Unlock()
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		r.mu.Lock()
		if !force && now.Before(r.retryAt) {
			r.mu.Unlock()
			return nil
		}
		ids := make([]string, 0, len(r.nodes))
		for id := range r.nodes {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		offset := sort.SearchStrings(ids, r.flushAfter)
		if offset < len(ids) && ids[offset] == r.flushAfter {
			offset++
		}
		ids = append(ids[offset:], ids[:offset]...)
		snapshots := []NodeHistory{}
		type snapshotVersion struct {
			owner   *telemetryNode
			version uint64
		}
		versions := map[string]snapshotVersion{}
		count, size := 0, 0
		for _, id := range ids {
			n := r.nodes[id]
			kept := n.data.Buckets[:0]
			for _, b := range n.data.Buckets {
				if b.Start < now.Add(-10*time.Minute).Unix() {
					if n.bucketVersions[b.Start] > n.persistedVersion {
						r.expiredDirty++
					}
					delete(n.bucketVersions, b.Start)
					continue
				}
				kept = append(kept, b)
			}
			n.data.Buckets = kept
			updated := historyMemory(n.data)
			r.bytes += updated - n.bytes
			n.bytes = updated
			if !n.dirty {
				continue
			}
			if count+len(n.data.Buckets) > 512 || size+n.bytes > 8<<20 {
				continue
			}
			snapshots = append(snapshots, cloneHistory(n.data))
			versions[id] = snapshotVersion{n, n.version}
			r.flushAfter = id
			count += len(n.data.Buckets)
			size += n.bytes
		}
		r.mu.Unlock()
		if len(snapshots) == 0 {
			return nil
		}
		r.mu.Lock()
		r.diagnostics.flushAttempt = now
		r.mu.Unlock()
		err := r.repo.SaveTelemetryHistory(ctx, snapshots, now)
		r.mu.Lock()
		if err != nil {
			r.failures++
			r.retryAt = now.Add(time.Duration(min(60, 5*r.failures)) * time.Second)
			r.mu.Unlock()
			return fmt.Errorf("persist telemetry history: %w", err)
		}
		r.diagnostics.flushSuccess = now
		r.failures = 0
		r.retryAt = time.Time{}
		for id, version := range versions {
			if n := r.nodes[id]; n != nil && n == version.owner {
				// All buckets in this version committed atomically, even if a
				// newer observation arrived while storage was writing.
				n.persistedVersion = version.version
				if n.version == version.version {
					n.dirty = false
				}
			}
		}
		r.mu.Unlock()
		if !force {
			return nil
		}
	}
}
func (r *TelemetryRecorder) Run(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	nextRotation := time.Time{}
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			work, cancel := context.WithTimeout(ctx, 5*time.Second)
			if !now.Before(nextRotation) {
				err := r.repo.RotateTelemetryHistory(work, now)
				r.mu.Lock()
				r.diagnostics.rotationAttempt = now
				r.diagnostics.rotationError = err != nil
				if err == nil {
					r.diagnostics.rotationSuccess = now
				}
				r.mu.Unlock()
				nextRotation = now.Add(time.Minute)
			}
			// Flush records real repository failures and retry deadlines. The bounded
			// status below replaces per-tick errors and per-bucket expiry log floods.
			flushErr := r.Flush(work, now, false)
			r.mu.Lock()
			r.diagnostics.cycleError = flushErr != nil
			r.mu.Unlock()
			if ctx.Err() == nil {
				r.recordDiagnostics(ctx, slog.Default(), now)
			}
			cancel()
		}
	}
}
