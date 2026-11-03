package monitoring

import (
	v1 "github.com/vioira/viorka/protocol/v1"
	"testing"
	"time"
)

func TestTypedBucketAggregationSemantics(t *testing.T) {
	at := time.Date(2026, 11, 2, 0, 0, 0, 0, time.UTC)
	b := NewBucket("n", at)
	for i, v := range []float64{10, 20, 30} {
		f := &v1.TelemetryFast{SampledAt: at.Add(time.Duration(i) * time.Second), CPUPercent: &v, RamUsed: valuePtr(uint64(100 + i)), RamTotal: valuePtr(uint64(1000 + i)), FilterRevision: "a", Interfaces: []*v1.TelemetryInterface{{RXBytes: uint64(10 + i), TXBytes: uint64(20 + i), RXBytesPerSecond: valuePtr(v), TXBytesPerSecond: valuePtr(50 - v)}}, TcpInuse: valuePtr(uint64(i)), UdpInuse: valuePtr(uint64(0))}
		if err := b.AddFast(f); err != nil {
			t.Fatal(err)
		}
	}
	if *b.CPU.Sum != 60 || b.CPU.Count != 3 || *b.NetInSpeed.Max != 30 || *b.NetOutSpeed.Max != 40 || *b.TCPCount.Max != 2 || *b.UDPCount.Max != 0 || *b.RAMTotal != 1002 || *b.NetInTotal != 12 {
		t.Fatal(b)
	}
	missing := &v1.TelemetryFast{SampledAt: at.Add(3 * time.Second), Errors: []string{"cpu_unavailable", "memory_unavailable", "network_unavailable", "sockets_unavailable"}}
	if err := b.AddFast(missing); err != nil {
		t.Fatal(err)
	}
	if b.CPU.Count != 3 || b.RAMUsed.Count != 3 || b.NetInSpeed.Count != 3 || b.TCPCount.Count != 3 {
		t.Fatal("unknown became zero", b)
	}
	slow := NewBucket("n", at.Add(30*time.Second))
	if err := slow.AddFull(&v1.TelemetryFull{SampledAt: at.Add(30 * time.Second), Load1: valuePtr(3.0), DiskIo: &v1.TelemetryDiskIO{ReadBytesPerSecond: valuePtr(10.0), UtilPercent: valuePtr(20.0)}}); err != nil {
		t.Fatal(err)
	}
	if slow.CPU.Sum != nil || slow.FastCount != 0 || slow.DiskIO.ReadSpeed.Count != 1 || slow.DiskIO.Await.Max != nil {
		t.Fatal(slow)
	}
	b.Merge(slow)
	if b.CPU.Count != 3 || b.FullCount != 1 || b.DiskIO.ReadSpeed.Count != 1 || *b.Load1 != 3 || *b.DiskIO.Util.Max != 20 {
		t.Fatal("coarse aggregation mixed semantics", b)
	}
}

func TestDiskSummaryTemporalPeaksAndUnknown(t *testing.T) {
	at := time.Date(2026, 11, 3, 0, 0, 0, 0, time.UTC)
	b := NewBucket("n", at)
	for i, d := range []*v1.TelemetryDiskIO{
		{ReadBytesPerSecond: valuePtr(10.0), WriteBytesPerSecond: valuePtr(30.0), ReadIops: valuePtr(1.0), AwaitMs: valuePtr(4.0), UtilPercent: valuePtr(80.0)},
		{ReadBytesPerSecond: valuePtr(40.0), WriteBytesPerSecond: valuePtr(0.0), ReadIops: valuePtr(0.0), Quality: []string{"partial"}},
		nil,
	} {
		f := &v1.TelemetryFull{SampledAt: at.Add(time.Duration(i) * time.Second), DiskIo: d}
		if d == nil {
			f.Errors = []string{"disk_io_unavailable"}
		}
		if err := b.AddFull(f); err != nil {
			t.Fatal(err)
		}
	}
	d := b.DiskIO
	if d.ReadSpeed.Count != 2 || *d.ReadSpeed.Max != 40 || *d.WriteSpeed.Max != 30 || d.Await.Count != 1 || *d.Await.Max != 4 || d.Util.Count != 1 || d.Quality == 0 {
		t.Fatal(d)
	}
	coarse := NewBucket("n", at)
	coarse.Merge(b)
	if coarse.DiskIO.ReadSpeed.Count != 2 || *coarse.DiskIO.ReadSpeed.Max != 40 || coarse.DiskIO.Quality == 0 {
		t.Fatal(coarse)
	}
}
