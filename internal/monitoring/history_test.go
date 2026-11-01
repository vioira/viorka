package monitoring

import (
	"context"
	"encoding/json"
	"fmt"
	v1 "github.com/vioira/viorka/protocol/v1"
	"sync"
	"testing"
	"time"
)

type memoryHistory struct{ rows []Rollup }

func (m *memoryHistory) SaveRollups(_ context.Context, rows []Rollup) error {
	m.rows = rows
	return nil
}
func (m *memoryHistory) RecentRollups(context.Context, time.Time) ([]Rollup, error) { return nil, nil }
func (m *memoryHistory) MetricHistory(context.Context, string, time.Time, time.Time, int) (History, error) {
	return History{}, nil
}
func (m *memoryHistory) PruneMetrics(context.Context, time.Time) error { return nil }
func TestBatchValidation(t *testing.T) {
	now := time.Now()
	one := sample(now)
	two := sample(now.Add(time.Second))
	for _, tc := range []struct {
		samples []*v1.NodeMetrics
		valid   bool
	}{{[]*v1.NodeMetrics{&one, &two}, true}, {nil, false}, {[]*v1.NodeMetrics{nil}, false}, {[]*v1.NodeMetrics{&two, &one}, false}, {[]*v1.NodeMetrics{&one, &one}, false}, {make([]*v1.NodeMetrics, 11), false}} {
		b, _ := json.Marshal(v1.NodeMetricsBatch{Samples: tc.samples})
		_, err := DecodeBatch(b, now)
		if (err == nil) != tc.valid {
			t.Fatalf("valid=%v err=%v", tc.valid, err)
		}
	}
}
func TestRecorderClocksBoundsAndConcurrency(t *testing.T) {
	repo := &memoryHistory{}
	ctx := context.Background()
	r, _ := NewRecorder(ctx, repo)
	now := time.Now().UTC().Truncate(time.Minute)
	r.Observe("n", sample(now), now, 180)
	if err := r.Flush(ctx, now.Add(60*time.Second), false); err != nil || len(repo.rows) != 0 {
		t.Fatalf("history period ignored %v", err)
	}
	if err := r.Flush(ctx, now.Add(180*time.Second), false); err != nil || len(repo.rows) != 1 {
		t.Fatalf("offline bucket not flushed %v", err)
	}
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for i := 0; i < 100; i++ {
			at := now.Add(time.Duration(i) * time.Second)
			r.Observe("n", sample(at), at, 30)
		}
	}()
	go func() {
		defer wg.Done()
		for i := 0; i < 100; i++ {
			r.Flush(ctx, now.Add(time.Duration(i)*time.Second), false)
		}
	}()
	wg.Wait()
	if len(r.nodes["n"].rows) > 4 {
		t.Fatal("unbounded minute buckets")
	}
}

func TestForcedFlushDrainsMoreThanOneBatchAndHonorsCancellation(t *testing.T) {
	repo := &memoryHistory{}
	ctx := context.Background()
	r, _ := NewRecorder(ctx, repo)
	at := time.Now().UTC()
	for i := 0; i < 600; i++ {
		r.Observe(fmt.Sprint(i), sample(at), at, 60)
	}
	if err := r.Flush(ctx, at, true); err != nil {
		t.Fatal(err)
	}
	for _, n := range r.nodes {
		if len(n.dirty) != 0 {
			t.Fatal("shutdown left a pending bucket")
		}
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if r.Flush(cancelled, at, true) != context.Canceled {
		t.Fatal("cancellation ignored")
	}
}

func TestHostHistoryValues(t *testing.T) {
	zero, rate := uint64(0), 1024.0
	m := sample(time.Now())
	m.Host = &v1.HostMetrics{Processes: &zero, TcpSockets: &zero, UdpSockets: &zero,
		DiskIo: []*v1.DiskIOMetrics{{ReadBytesPerSecond: &rate, WriteBytesPerSecond: &rate}, {ReadBytesPerSecond: &rate}}}
	values := metricValues(m)
	if values["disk_read"] != 2048 {
		t.Fatal(values)
	}
	if _, ok := values["disk_write"]; ok {
		t.Fatal("partial device rates must not be summed")
	}
	for _, key := range []string{"processes", "tcp_sockets", "udp_sockets"} {
		if n, ok := values[key]; !ok || n != 0 {
			t.Fatalf("lost zero %s", key)
		}
	}
	m.Host.Errors = []string{"disk_io_unavailable", "sockets_unavailable", "processes_unavailable"}
	for _, key := range []string{"disk_read", "disk_write", "processes", "tcp_sockets", "udp_sockets"} {
		if _, ok := metricValues(m)[key]; ok {
			t.Fatalf("invented unavailable %s", key)
		}
	}
	m.Host = nil
	if _, ok := metricValues(m)["processes"]; ok {
		t.Fatal("invented legacy metrics")
	}
}
