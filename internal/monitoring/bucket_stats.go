package monitoring

import (
	"errors"
	"math"
	"slices"
	"time"

	v1 "github.com/vioira/viorka/protocol/v1"
)

const (
	QualityPartial uint64 = 1 << iota
	QualityMixedFilter
)

func valuePtr[T any](v T) *T { return &v }
func copyValue[T any](v *T) *T {
	if v == nil {
		return nil
	}
	return valuePtr(*v)
}
func finite(v float64) bool { return v >= 0 && !math.IsNaN(v) && !math.IsInf(v, 0) }
func (s *Mean) Add(v float64) {
	if !finite(v) {
		return
	}
	if s.Sum == nil {
		s.Sum = valuePtr(v)
	} else {
		s.Sum = valuePtr(*s.Sum + v)
	}
	s.Count++
}
func (s Mean) Merge(other Mean) Mean {
	if other.Count == 0 {
		return s
	}
	if s.Count == 0 {
		return other
	}
	return Mean{Sum: valuePtr(*s.Sum + *other.Sum), Count: s.Count + other.Count}
}
func (s *Peak) Add(v float64) {
	if !finite(v) {
		return
	}
	if s.Max == nil || v > *s.Max {
		s.Max = valuePtr(v)
	}
	s.Count++
}
func (s Peak) Merge(other Peak) Peak {
	if other.Count == 0 {
		return s
	}
	if s.Count == 0 {
		return other
	}
	return Peak{Max: valuePtr(max(*s.Max, *other.Max)), Count: s.Count + other.Count}
}
func addPeak(s *Peak, v *float64) {
	if v != nil {
		s.Add(*v)
	}
}
func addCountPeak(s *Peak, v *uint64) {
	if v != nil {
		s.Add(float64(*v))
	}
}
func later(a, b *uint64) bool { return a != nil && (b == nil || *a >= *b) }
func NewBucket(node string, at time.Time) Bucket {
	return Bucket{Node: node, Start: at.UTC().Truncate(30 * time.Second).Unix(), Semantics: "telemetry_v3"}
}
func (b *Bucket) AddFast(f *v1.TelemetryFast) error {
	if f == nil || f.SampledAt.Unix()/30*30 != b.Start {
		return errors.New("fast observation outside bucket")
	}
	at := uint64(f.SampledAt.UnixMilli())
	b.FastCount++
	b.LastSample = max(b.LastSample, int64(at))
	if len(f.Errors) > 0 {
		b.Quality |= QualityPartial
	}
	if f.CPUPercent != nil && !slices.Contains(f.Errors, "cpu_unavailable") {
		b.CPU.Add(*f.CPUPercent)
	}
	if !slices.Contains(f.Errors, "memory_unavailable") {
		if f.RamUsed != nil {
			b.RAMUsed.Add(float64(*f.RamUsed))
		}
		if f.SwapUsed != nil {
			b.SwapUsed.Add(float64(*f.SwapUsed))
		}
		if later(&at, b.MemoryAt) && (f.RamTotal != nil || f.SwapTotal != nil) {
			b.RAMTotal = copyValue(f.RamTotal)
			b.SwapTotal = copyValue(f.SwapTotal)
			b.MemoryAt = &at
		}
	}
	if !slices.Contains(f.Errors, "sockets_unavailable") {
		addCountPeak(&b.TCPCount, f.TcpInuse)
		addCountPeak(&b.UDPCount, f.UdpInuse)
	}
	if f.UptimeSeconds != nil && !slices.Contains(f.Errors, "uptime_unavailable") && later(&at, b.UptimeAt) {
		b.Uptime = copyValue(f.UptimeSeconds)
		b.UptimeAt = &at
	}
	if b.FilterRevision != "" && b.FilterRevision != f.FilterRevision {
		b.Quality |= QualityMixedFilter
	}
	if !slices.Contains(f.Errors, "network_unavailable") && !slices.Contains(f.Errors, "unsupported_platform") {
		var rx, tx uint64
		var rxRate, txRate float64
		rxValid, txValid, totalsValid := true, true, true
		for _, i := range f.Interfaces {
			if i == nil || i.RXBytes > math.MaxInt64-rx || i.TXBytes > math.MaxInt64-tx {
				totalsValid = false
				rxValid = false
				txValid = false
				break
			}
			rx += i.RXBytes
			tx += i.TXBytes
			if slices.Contains(i.Quality, "partial") || slices.Contains(i.Quality, "unknown") {
				totalsValid = false
				rxValid = false
				txValid = false
			}
			if i.RXBytesPerSecond == nil {
				rxValid = false
			} else {
				rxRate += *i.RXBytesPerSecond
			}
			if i.TXBytesPerSecond == nil {
				txValid = false
			} else {
				txRate += *i.TXBytesPerSecond
			}
		}
		if rxValid {
			b.NetInSpeed.Add(rxRate)
		}
		if txValid {
			b.NetOutSpeed.Add(txRate)
		}
		if totalsValid && later(&at, b.NetworkAt) {
			b.NetInTotal = &rx
			b.NetOutTotal = &tx
			b.NetworkAt = &at
			b.FilterRevision = f.FilterRevision
		}
		if !totalsValid {
			b.Quality |= QualityPartial
		}
	}
	if t := f.Traffic; t != nil && later(&at, b.TrafficAt) && !slices.Contains(f.Errors, "traffic_unavailable") {
		b.MonthIn = copyValue(t.RXBytes)
		b.MonthOut = copyValue(t.TXBytes)
		b.MonthStart = valuePtr(uint64(t.MonthStart.Unix()))
		b.TrafficAt = &at
		b.TrafficFilterRevision = t.FilterRevision
		var flags uint64
		for _, q := range t.Quality {
			for bit, name := range []string{"baseline", "partial", "counter_reset", "identity_changed", "period_gap", "boundary_estimated", "mixed_filter", "persist_failed", "unknown"} {
				if q == name {
					flags |= 1 << bit
				}
			}
		}
		b.TrafficQuality = &flags
	}
	return nil
}
func (b *Bucket) AddFull(f *v1.TelemetryFull) error {
	if f == nil || f.SampledAt.Unix()/30*30 != b.Start {
		return errors.New("full observation outside bucket")
	}
	at := uint64(f.SampledAt.UnixMilli())
	b.FullCount++
	b.LastSample = max(b.LastSample, int64(at))
	if len(f.Errors) > 0 {
		b.Quality |= QualityPartial
	}
	if !slices.Contains(f.Errors, "processes_unavailable") {
		addCountPeak(&b.ProcessCount, f.Processes)
	}
	if !slices.Contains(f.Errors, "load_unavailable") && later(&at, b.LoadAt) && (f.Load1 != nil || f.Load5 != nil || f.Load15 != nil) {
		b.Load1 = copyValue(f.Load1)
		b.Load5 = copyValue(f.Load5)
		b.Load15 = copyValue(f.Load15)
		b.LoadAt = &at
	}
	if !slices.Contains(f.Errors, "disk_unavailable") && later(&at, b.DiskAt) && f.DiskTotal != nil {
		b.DiskTotal = copyValue(f.DiskTotal)
		b.DiskUsed = copyValue(f.DiskUsed)
		b.DiskAvailable = copyValue(f.DiskAvailable)
		b.DiskAt = &at
	}
	if !slices.Contains(f.Errors, "disk_unavailable") {
		for _, f := range f.Filesystems {
			if f != nil {
				b.mergeFilesystem(FilesystemBucket{Identity: f.Identity, MountPoint: f.MountPoint, FilesystemType: f.FilesystemType, Total: f.TotalBytes, Used: f.UsedBytes, Available: f.AvailableBytes, SampledAt: int64(at)})
			}
		}
	}
	if d := f.DiskIo; d != nil && !slices.Contains(f.Errors, "disk_io_unavailable") {
		v := DiskBucket{LastSample: int64(at)}
		if len(d.Quality) > 0 {
			v.Quality = QualityPartial
			b.Quality |= QualityPartial
		}
		addPeak(&v.ReadSpeed, d.ReadBytesPerSecond)
		addPeak(&v.WriteSpeed, d.WriteBytesPerSecond)
		addPeak(&v.ReadIOPS, d.ReadIops)
		addPeak(&v.WriteIOPS, d.WriteIops)
		addPeak(&v.ReadAwait, d.ReadAwaitMs)
		addPeak(&v.WriteAwait, d.WriteAwaitMs)
		addPeak(&v.Await, d.AwaitMs)
		addPeak(&v.Util, d.UtilPercent)
		b.mergeDisk(v)
	} else {
		b.DiskIO.Quality |= QualityPartial
	}

	return nil
}
func (b *Bucket) mergeFilesystem(f FilesystemBucket) {
	for i, old := range b.Filesystems {
		if old.Identity == f.Identity {
			if f.SampledAt >= old.SampledAt {
				b.Filesystems[i] = f
			}
			return
		}
	}
	b.Filesystems = append(b.Filesystems, f)
}
func (b *Bucket) mergeDisk(d DiskBucket) {
	old := b.DiskIO
	d.ReadSpeed = old.ReadSpeed.Merge(d.ReadSpeed)
	d.WriteSpeed = old.WriteSpeed.Merge(d.WriteSpeed)
	d.ReadIOPS = old.ReadIOPS.Merge(d.ReadIOPS)
	d.WriteIOPS = old.WriteIOPS.Merge(d.WriteIOPS)
	d.ReadAwait = old.ReadAwait.Merge(d.ReadAwait)
	d.WriteAwait = old.WriteAwait.Merge(d.WriteAwait)
	d.Await = old.Await.Merge(d.Await)
	d.Util = old.Util.Merge(d.Util)
	d.LastSample = max(old.LastSample, d.LastSample)
	d.Quality |= old.Quality
	b.DiskIO = d
}

// Merge combines disjoint observations for a coarser query, preserving each
// field's own count and each latest-value group's original timestamp.
func (b *Bucket) Merge(other Bucket) {
	b.UpdatedAt = max(b.UpdatedAt, other.UpdatedAt)
	b.FastCount += other.FastCount
	b.FullCount += other.FullCount
	b.LastSample = max(b.LastSample, other.LastSample)
	if b.Semantics == "" {
		b.Semantics = other.Semantics
	} else if b.Semantics != other.Semantics {
		b.Semantics = "mixed"
	}
	b.Quality |= other.Quality
	b.CPU = b.CPU.Merge(other.CPU)
	b.RAMUsed = b.RAMUsed.Merge(other.RAMUsed)
	b.SwapUsed = b.SwapUsed.Merge(other.SwapUsed)
	b.NetInSpeed = b.NetInSpeed.Merge(other.NetInSpeed)
	b.NetOutSpeed = b.NetOutSpeed.Merge(other.NetOutSpeed)
	b.TCPCount = b.TCPCount.Merge(other.TCPCount)
	b.UDPCount = b.UDPCount.Merge(other.UDPCount)
	b.ProcessCount = b.ProcessCount.Merge(other.ProcessCount)
	if b.FilterRevision != "" && other.FilterRevision != "" && b.FilterRevision != other.FilterRevision {
		b.Quality |= QualityMixedFilter
	}
	if later(other.MemoryAt, b.MemoryAt) {
		b.MemoryAt = other.MemoryAt
		b.RAMTotal = other.RAMTotal
		b.SwapTotal = other.SwapTotal
	}
	if later(other.NetworkAt, b.NetworkAt) {
		b.NetworkAt = other.NetworkAt
		b.NetInTotal = other.NetInTotal
		b.NetOutTotal = other.NetOutTotal
		b.FilterRevision = other.FilterRevision
	}
	if later(other.TrafficAt, b.TrafficAt) {
		b.TrafficAt = other.TrafficAt
		b.MonthIn = other.MonthIn
		b.MonthOut = other.MonthOut
		b.MonthStart = other.MonthStart
		b.TrafficQuality = other.TrafficQuality
		b.TrafficFilterRevision = other.TrafficFilterRevision
	}
	if later(other.DiskAt, b.DiskAt) {
		b.DiskAt = other.DiskAt
		b.DiskTotal = other.DiskTotal
		b.DiskUsed = other.DiskUsed
		b.DiskAvailable = other.DiskAvailable
	}
	if later(other.LoadAt, b.LoadAt) {
		b.LoadAt = other.LoadAt
		b.Load1 = other.Load1
		b.Load5 = other.Load5
		b.Load15 = other.Load15
	}
	if later(other.UptimeAt, b.UptimeAt) {
		b.UptimeAt = other.UptimeAt
		b.Uptime = other.Uptime
	}
	b.mergeDisk(other.DiskIO)
	for _, f := range other.Filesystems {
		b.mergeFilesystem(f)
	}
}
