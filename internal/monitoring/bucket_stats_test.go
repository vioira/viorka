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
	if err := slow.AddFull(&v1.TelemetryFull{SampledAt: at.Add(30 * time.Second), Load1: valuePtr(3.0), DiskIo: []*v1.TelemetryDiskIO{{Device: "sda", ReadBytesPerSecond: valuePtr(10.0), UtilPercent: valuePtr(20.0)}, {Device: "dm-0", ReadBytesPerSecond: valuePtr(10.0), UtilPercent: valuePtr(30.0)}}}); err != nil {
		t.Fatal(err)
	}
	if slow.CPU.Sum != nil || slow.FastCount != 0 || len(slow.DiskIO) != 2 || slow.DiskIO[0].Await.Max != nil {
		t.Fatal(slow)
	}
	b.Merge(slow)
	if b.CPU.Count != 3 || b.FullCount != 1 || len(b.DiskIO) != 2 || *b.Load1 != 3 || *b.DiskIO[0].Util.Max != 20 {
		t.Fatal("coarse aggregation mixed semantics", b)
	}
}
