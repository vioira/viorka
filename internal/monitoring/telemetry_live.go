package monitoring

import (
	"encoding/json"
	"maps"
	"math"
	"math/big"
	"time"

	v1 "github.com/vioira/viorka/protocol/v1"
)

const telemetryLiveBudget = 32 << 20
const telemetryPointBudget = 1024 // conservative map/point overhead, in addition to encoded snapshot

type TelemetryLivePoint struct {
	Group          string             `json:"group" enum:"fast,full"`
	Sequence       uint64             `json:"sequence"`
	SampleSequence string             `json:"sample_sequence"`
	At             time.Time          `json:"at"`
	ReceivedAt     time.Time          `json:"received_at"`
	Values         map[string]float64 `json:"values"`
}
type TelemetryLiveSnapshot struct {
	Settings *v1.TelemetrySettings `json:"settings,omitempty"`
	TelemetrySnapshot
	Generation uint64               `json:"-"`
	Sequence   uint64               `json:"sequence"`
	Reset      bool                 `json:"reset"`
	Points     []TelemetryLivePoint `json:"points"`
}
type telemetryLiveEntry struct {
	run                  string
	groupSequence        [3]uint64
	snapshot             json.RawMessage // immutable, bounded by the validated source batch
	points               []TelemetryLivePoint
	generation, sequence uint64
	bytes                int
	settings             v1.TelemetrySettings
}

// Owned exclusively by TelemetryIngress.mu. prepare does not mutate the cache;
// history admission must succeed before commit. Decoding bounded snapshots on
// reads gives callers independent objects without exposing mutable cache state.
type telemetryLiveCache struct {
	entries    map[string]telemetryLiveEntry
	bytes      int
	generation uint64
}

func newTelemetryLiveCache() *telemetryLiveCache {
	return &telemetryLiveCache{entries: map[string]telemetryLiveEntry{}}
}
func (c *telemetryLiveCache) prepare(batch v1.TelemetryBatch, now time.Time, settings v1.TelemetrySettings, floor [3]uint64) (telemetryLiveEntry, error) {
	old, exists := c.entries[batch.NodeID]
	if !exists && len(c.entries) >= MaxNodes {
		return telemetryLiveEntry{}, ErrTelemetryOverloaded
	}
	next := old
	var snapshot TelemetrySnapshot
	if old.run != batch.RunID {
		if c.generation == math.MaxInt64 {
			return telemetryLiveEntry{}, ErrTelemetryOverloaded
		}
		next = telemetryLiveEntry{run: batch.RunID, generation: c.generation + 1}
	} else if err := json.Unmarshal(old.snapshot, &snapshot); err != nil {
		return telemetryLiveEntry{}, err
	}
	snapshot.RunID = batch.RunID
	snapshot.MetricsReceivedAt = now
	next.settings = settings
	// Copy the retained slice. Published maps are immutable and safe to share
	// internally; external readers receive independent map copies below.
	next.points = make([]TelemetryLivePoint, 0, min(MaxLiveSamples, len(old.points)+len(batch.Fast)+len(batch.Full)))
	if old.run == batch.RunID {
		for _, point := range old.points {
			if point.At.After(now.Add(-LiveWindow)) {
				next.points = append(next.points, point)
			}
		}
	}
	for _, sample := range batch.Fast {
		if sample.Sequence < floor[0] || sample.Sequence <= next.groupSequence[0] {
			continue
		}
		if next.sequence == math.MaxUint64 {
			return telemetryLiveEntry{}, ErrTelemetryOverloaded
		}
		next.groupSequence[0] = sample.Sequence
		snapshot.Fast = telemetryFastView(sample)
		snapshot.FastReceivedAt = now
		if sample.Sequence <= floor[0] {
			continue
		}
		next.sequence++
		next.points = append(next.points, TelemetryLivePoint{Group: "fast", Sequence: next.sequence, SampleSequence: snapshot.Fast.Sequence, At: sample.SampledAt, ReceivedAt: now, Values: telemetryFastValues(sample)})
		if len(next.points) > MaxLiveSamples {
			next.points[0] = TelemetryLivePoint{}
			next.points = next.points[1:]
		}
	}
	for _, sample := range batch.Full {
		if sample.Sequence >= floor[1] && sample.Sequence > next.groupSequence[1] {
			next.groupSequence[1] = sample.Sequence
			snapshot.Full = telemetryFullView(sample)
			snapshot.FullReceivedAt = now
			if sample.Sequence <= floor[1] {
				continue
			}
			if next.sequence == math.MaxUint64 {
				return telemetryLiveEntry{}, ErrTelemetryOverloaded
			}
			next.sequence++
			next.points = append(next.points, TelemetryLivePoint{Group: "full", Sequence: next.sequence, SampleSequence: snapshot.Full.Sequence, At: sample.SampledAt, ReceivedAt: now, Values: telemetryFullValues(sample)})
			if len(next.points) > MaxLiveSamples {
				next.points[0] = TelemetryLivePoint{}
				next.points = next.points[1:]
			}
		}
	}
	for _, sample := range batch.PublicIp {
		if sample.Sequence >= floor[2] && sample.Sequence > next.groupSequence[2] {
			next.groupSequence[2] = sample.Sequence
			snapshot.PublicIP = telemetryPublicIPView(sample)
			snapshot.PublicIPReceivedAt = now
		}
	}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		return telemetryLiveEntry{}, err
	}
	next.snapshot = raw
	next.bytes = len(raw) + len(next.points)*telemetryPointBudget
	if c.bytes-old.bytes+next.bytes > telemetryLiveBudget {
		return telemetryLiveEntry{}, ErrTelemetryOverloaded
	}
	return next, nil
}
func (c *telemetryLiveCache) commit(node string, next telemetryLiveEntry) {
	c.bytes += next.bytes - c.entries[node].bytes
	c.entries[node] = next
	c.generation = max(c.generation, next.generation)
}
func (c *telemetryLiveCache) forget(node string) {
	c.bytes -= c.entries[node].bytes
	delete(c.entries, node)
}
func (c *telemetryLiveCache) get(node string, now time.Time, cursor Cursor, realtime, summary bool) (TelemetryLiveSnapshot, error) {
	out := TelemetryLiveSnapshot{Reset: true, Points: []TelemetryLivePoint{}}
	entry, ok := c.entries[node]
	if !ok {
		out.TelemetrySnapshot = out.TelemetrySnapshot.freshness(now, v1.DefaultTelemetrySettings(), realtime)
		return out, nil
	}
	if err := json.Unmarshal(entry.snapshot, &out.TelemetrySnapshot); err != nil {
		return out, err
	}
	out.TelemetrySnapshot = out.TelemetrySnapshot.freshness(now, entry.settings, realtime)
	applied := entry.settings
	out.Settings = &applied
	out.Generation = entry.generation
	out.Sequence = entry.sequence
	out.Reset = summary || cursor.Generation != entry.generation || cursor.Sequence == 0 || cursor.Sequence > entry.sequence || (len(entry.points) > 0 && cursor.Sequence < entry.points[0].Sequence-1)
	if summary {
		if out.Fast != nil {
			out.Fast.Interfaces = []*TelemetryInterfaceView{}
		}
		if out.Full != nil {
			out.Full.Filesystems = []*TelemetryFilesystemView{}
			out.Full.DiskIo = nil
		}
	}
	if !summary {
		for _, point := range entry.points {
			if point.At.After(now.Add(-LiveWindow)) && (out.Reset || point.Sequence > cursor.Sequence) {
				point.Values = maps.Clone(point.Values)
				out.Points = append(out.Points, point)
			}
		}
	}
	return out, nil
}
func telemetryFastValues(f *v1.TelemetryFast) map[string]float64 {
	values := map[string]float64{}
	if f.CPUPercent != nil {
		values["cpu_percent"] = *f.CPUPercent
	}
	if f.RamTotal != nil && *f.RamTotal > 0 && f.RamUsed != nil {
		values["memory_percent"] = float64(*f.RamUsed) / float64(*f.RamTotal) * 100
	}
	if f.SwapTotal != nil && *f.SwapTotal > 0 && f.SwapUsed != nil {
		values["swap_percent"] = float64(*f.SwapUsed) / float64(*f.SwapTotal) * 100
	}
	if f.UptimeSeconds != nil {
		values["uptime_seconds"] = *f.UptimeSeconds
	}
	if f.TcpInuse != nil {
		values["tcp_inuse"] = float64(*f.TcpInuse)
	}
	if f.UdpInuse != nil {
		values["udp_inuse"] = float64(*f.UdpInuse)
	}
	rx, tx := 0.0, 0.0
	valid := len(f.Interfaces) > 0
	for _, nic := range f.Interfaces {
		if nic.RXBytesPerSecond == nil || nic.TXBytesPerSecond == nil {
			valid = false
			break
		}
		rx += *nic.RXBytesPerSecond
		tx += *nic.TXBytesPerSecond
	}
	if valid {
		values["rx_bytes_per_second"] = rx
		values["tx_bytes_per_second"] = tx
	}
	return values
}

// Durable history watermarks also fence the ephemeral live cache after restart.
func (r *TelemetryRecorder) watermarks(node, run string) [3]uint64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out [3]uint64
	if n := r.nodes[node]; n != nil {
		for _, c := range n.data.Checkpoints {
			if c.RunID != run {
				continue
			}
			switch c.Group {
			case "fast":
				out[0] = c.Sequence
			case "full":
				out[1] = c.Sequence
			case "public_ip":
				out[2] = c.Sequence
			}
		}
	}
	return out
}

// Control status reports acknowledgment separately from viewer demand and data
// freshness. A viewer reference is never evidence that realtime is applied.
type TelemetryControlStatus struct {
	Mode                  string `json:"mode" enum:"http,pending,realtime,degraded"`
	References            int    `json:"references"`
	LeaseRemainingSeconds uint64 `json:"lease_remaining_seconds"`
}

// Full observations keep their own cadence and timestamps; never repeat them
// at each fast tick or turn missing values into zero.
func telemetryFullValues(f *v1.TelemetryFull) map[string]float64 {
	values := map[string]float64{}
	for key, value := range map[string]*float64{"load_1": f.Load1, "load_5": f.Load5, "load_15": f.Load15} {
		if value != nil {
			values[key] = *value
		}
	}
	if f.Processes != nil {
		values["processes"] = float64(*f.Processes)
	}
	if f.DiskUsed != nil && f.DiskAvailable != nil {
		used := new(big.Int).SetUint64(*f.DiskUsed)
		denominator := new(big.Int).Add(used, new(big.Int).SetUint64(*f.DiskAvailable))
		if denominator.Sign() > 0 {
			numerator := new(big.Int).Mul(used, big.NewInt(100))
			quotient, remainder := new(big.Int).QuoRem(numerator, denominator, new(big.Int))
			if remainder.Sign() > 0 {
				quotient.Add(quotient, big.NewInt(1))
			}
			values["disk_percent"] = float64(quotient.Uint64())
		}
	}
	if d := f.DiskIo; d != nil {
		for key, value := range map[string]*float64{
			"disk_read": d.ReadBytesPerSecond, "disk_write": d.WriteBytesPerSecond,
			"disk_read_iops": d.ReadIops, "disk_write_iops": d.WriteIops,
			"disk_await_ms": d.AwaitMs, "disk_util_percent": d.UtilPercent,
		} {
			if value != nil {
				values[key] = *value
			}
		}
		if len(d.Quality) > 0 {
			values["disk_io_partial"] = 1
		}
	}

	return values
}
