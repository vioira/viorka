package monitoring

import (
	"context"
	"encoding/json"
	"fmt"
	v1 "github.com/vioira/viorka/protocol/v1"
	"log/slog"
	"maps"
	"slices"
	"sync"
	"time"
)

// Statistics retain sufficient information to merge unequal sample counts.
// Avg is a sample mean, not an interpolation over missing time.
type Statistic struct {
	Sum   float64 `json:"sum"`
	Max   float64 `json:"max"`
	Count uint64  `json:"count"`
}

func (s Statistic) Add(v float64) Statistic { s.Sum += v; s.Max = max(s.Max, v); s.Count++; return s }
func (s Statistic) Merge(v Statistic) Statistic {
	s.Sum += v.Sum
	s.Max = max(s.Max, v.Max)
	s.Count += v.Count
	return s
}

type Rollup struct {
	Node       string               `json:"-"`
	At         time.Time            `json:"at"`
	LastSample time.Time            `json:"last_sample_at"`
	Stats      map[string]Statistic `json:"stats"`
}
type History struct {
	PeriodSeconds int      `json:"period_seconds"`
	Points        []Rollup `json:"points"`
}
type HistoryRepository interface {
	SaveRollups(context.Context, []Rollup) error
	RecentRollups(context.Context, time.Time) ([]Rollup, error)
	MetricHistory(context.Context, string, time.Time, time.Time, int) (History, error)
	PruneMetrics(context.Context, time.Time) error
}
type pendingNode struct {
	rows     map[int64]Rollup
	dirty    map[int64]bool
	last     time.Time
	due      time.Time
	seen     time.Time
	interval time.Duration
}
type Recorder struct {
	mu       sync.Mutex
	repo     HistoryRepository
	nodes    map[string]*pendingNode
	retryAt  time.Time
	failures int
}

func NewRecorder(ctx context.Context, repo HistoryRepository) (*Recorder, error) {
	r := &Recorder{repo: repo, nodes: map[string]*pendingNode{}}
	rows, err := repo.RecentRollups(ctx, time.Now().Add(-10*time.Minute))
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		n := r.node(row.Node, time.Now())
		if n == nil {
			continue
		}
		n.rows[row.At.Unix()] = row
		if row.LastSample.After(n.last) {
			n.last = row.LastSample
		}
	}
	return r, nil
}
func (r *Recorder) node(id string, now time.Time) *pendingNode {
	n := r.nodes[id]
	if n == nil {
		if len(r.nodes) >= MaxNodes {
			return nil
		}
		n = &pendingNode{rows: map[int64]Rollup{}, dirty: map[int64]bool{}, interval: time.Minute, due: now.Add(time.Minute)}
		r.nodes[id] = n
	}
	n.seen = now
	return n
}
func (r *Recorder) Observe(id string, m v1.NodeMetrics, now time.Time, seconds uint64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	n := r.node(id, now)
	if n == nil || !m.SampledAt.After(n.last) {
		return
	}
	if seconds >= 30 && seconds <= 180 {
		interval := time.Duration(seconds) * time.Second
		if n.interval != interval {
			n.interval = interval
			n.due = now.Add(interval)
		}
	}

	n.last = m.SampledAt
	at := m.SampledAt.UTC().Truncate(time.Minute)
	key := at.Unix()
	row := n.rows[key]
	if row.Stats == nil {
		row = Rollup{Node: id, At: at, Stats: map[string]Statistic{}}
	}
	for k, v := range metricValues(m) {
		row.Stats[k] = row.Stats[k].Add(v)
	}
	row.LastSample = m.SampledAt
	n.rows[key] = row
	n.dirty[key] = true
}
func metricValues(m v1.NodeMetrics) map[string]float64 {
	v := map[string]float64{}
	if m.CPU != nil && m.CPU.UsagePercent != nil {
		v["cpu"] = *m.CPU.UsagePercent
	}
	if m.Memory != nil {
		v["memory"] = 100 * m.Memory.UsedBytes / m.Memory.TotalBytes
		v["memory_used_bytes"] = m.Memory.UsedBytes
		v["memory_total_bytes"] = m.Memory.TotalBytes
		v["swap_used_bytes"] = m.Memory.SwapUsedBytes
		v["swap_total_bytes"] = m.Memory.SwapTotalBytes
		if m.Memory.SwapTotalBytes > 0 {
			v["swap"] = 100 * m.Memory.SwapUsedBytes / m.Memory.SwapTotalBytes
		}
	}
	if m.Load != nil {
		v["load_one"] = m.Load.One
		v["load_five"] = m.Load.Five
		v["load_fifteen"] = m.Load.Fifteen
	}
	if m.Disk != nil {
		v["disk"] = 100 * m.Disk.UsedBytes / m.Disk.TotalBytes
		v["disk_used_bytes"] = m.Disk.UsedBytes
		v["disk_total_bytes"] = m.Disk.TotalBytes
	}
	if !slices.Contains(m.Errors, "network_unavailable") && !slices.Contains(m.Errors, "unsupported_platform") {
		rx, tx := 0.0, 0.0
		valid := true
		for _, i := range m.Interfaces {
			if i.RXBytesPerSecond == nil || i.TXBytesPerSecond == nil {
				valid = false
				break
			}
			rx += *i.RXBytesPerSecond
			tx += *i.TXBytesPerSecond
		}
		if valid {
			v["rx"] = rx
			v["tx"] = tx
		}
	}
	return v
}

// Flush snapshots under the lock, then performs bounded I/O without blocking
// ingestion. Absolute bucket replacement makes retries idempotent.
func (r *Recorder) Flush(ctx context.Context, now time.Time, force bool) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	r.mu.Lock()
	rows := []Rollup{}
	for id, n := range r.nodes {
		for k, row := range n.rows {
			if row.At.Before(now.Add(-10 * time.Minute)) {
				if n.dirty[k] {
					slog.Warn("expired unpersisted metric bucket", "node_id", id)
				}
				delete(n.rows, k)
				delete(n.dirty, k)
			}
		}
		if now.Sub(n.seen) > time.Hour && len(n.rows) == 0 {
			delete(r.nodes, id)
			continue
		}
		if !force && (now.Before(n.due) || now.Before(r.retryAt)) {
			continue
		}
		for k := range n.dirty {
			if len(rows) >= 512 {
				break
			}
			row := n.rows[k]
			row.Stats = maps.Clone(row.Stats)
			rows = append(rows, row)
		}
	}
	r.mu.Unlock()
	if len(rows) == 0 {
		return nil
	}
	err := r.repo.SaveRollups(ctx, rows)
	r.mu.Lock()
	if err != nil {
		r.failures++
		r.retryAt = now.Add(time.Duration(min(60, 5*r.failures)) * time.Second)
		r.mu.Unlock()
		return err
	}
	r.failures = 0
	r.retryAt = time.Time{}
	for _, row := range rows {
		n := r.nodes[row.Node]
		if n == nil {
			continue
		}
		k := row.At.Unix()
		if n.rows[k].LastSample.Equal(row.LastSample) {
			delete(n.dirty, k)
		}
		n.due = now.Add(n.interval)
	}
	more := false
	if force {
		for _, n := range r.nodes {
			if len(n.dirty) > 0 {
				more = true
				break
			}
		}
	}
	r.mu.Unlock()
	if more {
		return r.Flush(ctx, now, true)
	}
	return nil
}
func (r *Recorder) Run(ctx context.Context) {
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	nextPrune := time.Time{}
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-tick.C:
			work, cancel := context.WithTimeout(ctx, 5*time.Second)
			err := r.Flush(work, now, false)
			cancel()
			if err != nil && ctx.Err() == nil {
				slog.Error("metric history write failed")
			}
			if !now.Before(nextPrune) {
				work, cancel := context.WithTimeout(ctx, 5*time.Second)
				err := r.repo.PruneMetrics(work, now.Add(-7*24*time.Hour))
				cancel()
				if err != nil && ctx.Err() == nil {
					slog.Error("metric history cleanup failed")
				}
				nextPrune = now.Add(time.Minute)
			}
		}
	}
}
func DecodeBatch(b []byte, now time.Time) ([]v1.NodeMetrics, error) {
	var raw struct {
		Samples []json.RawMessage `json:"samples"`
	}
	if err := v1.Decode(b, &raw); err != nil {
		return nil, err
	}
	if len(raw.Samples) < 1 || len(raw.Samples) > 10 {
		return nil, fmt.Errorf("invalid metrics batch size")
	}
	out := make([]v1.NodeMetrics, 0, len(raw.Samples))
	for _, sample := range raw.Samples {
		m, err := Decode(sample, now)
		if err != nil {
			return nil, err
		}
		if len(out) > 0 && !m.SampledAt.After(out[len(out)-1].SampledAt) {
			return nil, fmt.Errorf("unordered metrics batch")
		}
		out = append(out, m)
	}
	return out, nil
}
