package monitoring

import (
	"encoding/json"
	"fmt"
	v1 "github.com/vioira/viorka/protocol/v1"
	"sync"
	"testing"
	"time"
)

func sample(now time.Time) v1.NodeMetrics {
	return v1.NodeMetrics{SampledAt: now, IntervalSeconds: 30, CPU: &v1.CPUMetrics{LogicalCPUs: 2, UsagePercent: ptr(25)}, Memory: &v1.MemoryMetrics{TotalBytes: 100, AvailableBytes: 60, UsedBytes: 40}, Load: &v1.LoadMetrics{}, Disk: &v1.DiskMetrics{TotalBytes: 100, UsedBytes: 30, AvailableBytes: 60}, UptimeSeconds: ptr(100), Interfaces: []*v1.InterfaceMetrics{{Name: "eth0", RXBytes: 1000, TXBytes: 2000, RXBytesPerSecond: ptr(10), TXBytesPerSecond: ptr(20)}}, Errors: []string{}}
}
func TestDecodeValidation(t *testing.T) {
	now := time.Now()
	m := sample(now)
	b, _ := json.Marshal(m)
	if _, e := Decode(b, now); e != nil {
		t.Fatal(e)
	}
	for _, mutate := range []func(map[string]any){
		func(m map[string]any) { delete(m, "errors") }, func(m map[string]any) { m["interfaces"] = nil }, func(m map[string]any) { m["cpu"] = map[string]any{} }, func(m map[string]any) { m["cpu"].(map[string]any)["usage_percent"] = 101.0 }, func(m map[string]any) { m["errors"] = []string{"cpu_unavailable"} }, func(m map[string]any) { m["memory"].(map[string]any)["used_bytes"] = 101.0 }, func(m map[string]any) { m["interfaces"] = []any{nil} }, func(m map[string]any) { m["sampled_at"] = now.Add(-6 * time.Minute) }, func(m map[string]any) { m["interval_seconds"] = 601 }, func(m map[string]any) { m["secret"] = "no" }, func(m map[string]any) { m["interfaces"].([]any)[0].(map[string]any)["rx_bytes_per_second"] = -1.0 },
	} {
		var raw map[string]any
		json.Unmarshal(b, &raw)
		mutate(raw)
		bad, _ := json.Marshal(raw)
		if _, e := Decode(bad, now); e == nil {
			t.Fatalf("accepted %s", bad)
		}
	}
	unsupported := v1.NodeMetrics{SampledAt: now, Errors: []string{"unsupported_platform"}, Interfaces: []*v1.InterfaceMetrics{}}
	b, _ = json.Marshal(unsupported)
	if _, e := Decode(b, now); e != nil {
		t.Fatal(e)
	}
}
func TestHistoryFreshnessAndBounds(t *testing.T) {
	s := New()
	now := time.Now().UTC().Truncate(time.Minute)
	m := sample(now)
	s.Put("node", m, now)
	if v := s.Get("node", now, true); v.Stale || len(v.History) != 1 || *v.History[0].RX != 10 {
		t.Fatal(v)
	}
	changed := sample(now.Add(time.Second))
	s.Put("node", changed, now.Add(time.Second))
	if !s.Get("node", now, true).Latest.SampledAt.Equal(changed.SampledAt) {
		t.Fatal("one-second samples must be accepted")
	}
	s.Put("node", sample(now.Add(-time.Second)), now.Add(10*time.Second))
	if !s.Get("node", now, true).Latest.SampledAt.Equal(changed.SampledAt) {
		t.Fatal("late sample")
	}
	if !s.Get("node", now.Add(92*time.Second), true).Stale {
		t.Fatal("stale not marked")
	}
	for i := 1; i < 150; i++ {
		at := now.Add(time.Duration(i) * 30 * time.Second)
		s.Put("node", sample(at), at)
	}
	if n := len(s.Get("node", now.Add(149*30*time.Second), true).History); n != 60 {
		t.Fatalf("history length %d", n)
	}
	if len(s.Get("node", now.Add(3*time.Hour), true).History) != 0 {
		t.Fatal("history expiry")
	}
	if len(s.Get("node", now, false).History) != 0 {
		t.Fatal("list includes history")
	}
	for i := 0; i < MaxNodes+2; i++ {
		s.Put(fmt.Sprint(i), sample(now), now)
	}
	if len(s.entries) != MaxNodes {
		t.Fatal("unbounded nodes")
	}
}
func TestConcurrentMonitoring(t *testing.T) {
	s := New()
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				now := time.Now()
				s.Put(fmt.Sprint(i), sample(now), now)
				s.Get(fmt.Sprint(i), now, true)
			}
		}(i)
	}
	wg.Wait()
}

func TestUnavailableNetworkIsNotZero(t *testing.T) {
	s := New()
	now := time.Now()
	s.Put("node", v1.NodeMetrics{SampledAt: now, Errors: []string{"unsupported_platform"}, Interfaces: []*v1.InterfaceMetrics{}}, now)
	v := s.Get("node", now, true)
	if v.History[0].RX != nil || v.History[0].TX != nil {
		t.Fatal("unknown network became zero")
	}
}

func TestLongReportIntervalIsNotPrematurelyStale(t *testing.T) {
	s := New()
	at := time.Now()
	s.Put("n", v1.NodeMetrics{SampledAt: at, IntervalSeconds: 10}, at)
	s.SetReportInterval("n", 300)
	if s.Get("n", at.Add(5*time.Minute), false).Stale {
		t.Fatal("configured slow report incorrectly stale")
	}
	if !s.Get("n", at.Add(16*time.Minute), false).Stale {
		t.Fatal("missing report never becomes stale")
	}
}
