package monitoring

import (
	"testing"
	"time"
)

func TestMetricTrendsServerWindowAndDeltas(t *testing.T) {
	end := time.Date(2026, 11, 13, 0, 10, 0, 0, time.UTC)
	trend, initial := NewMetricTrendWindows(History{PeriodSeconds: 30, Points: []Bucket{{Start: end.Add(-30 * time.Second).Unix(), NetInSpeed: Peak{Max: ptr(42), Count: 1}}}}, end.Add(-LiveWindow), end)
	first := initial["network"]
	if !first.Reset || len(first.Points) != 20 || *first.Points[19].Values["rx"] != 42 || first.Points[19].Values["tx"] != nil {
		t.Fatal(first)
	}
	client := map[string]MetricTrendPoint{}
	for _, p := range first.Points {
		client[p.ID] = p
	}
	for i := 1; i <= 150; i++ {
		at := end.Add(time.Duration(i) * time.Second)
		values := map[string]float64{"rx_bytes_per_second": float64(i), "tx_bytes_per_second": float64(i * 2)}
		if i == 100 {
			values = map[string]float64{}
		}
		delta := trend.Update([]TelemetryLivePoint{{Group: "fast", Sequence: uint64(i), At: at, Values: values}}, at)["network"]
		if delta.Reset || len(delta.Points) != 1 {
			t.Fatalf("resent retained points: %+v", delta)
		}
		for _, id := range delta.RemovedIDs {
			delete(client, id)
		}
		for _, p := range delta.Points {
			client[p.ID] = p
		}
		if len(client) > 120 || len(client) != len(trend.Snapshot()["network"].Points) {
			t.Fatal("unbounded or divergent client", len(client), len(trend.Snapshot()["network"].Points))
		}
	}
	if len(client) != 120 || trend.Snapshot()["network"].Points[0].ID != "l:31" || client["l:100"].Values["rx"] != nil {
		t.Fatal("window lost ordering/gaps", trend.Snapshot()["network"].Points)
	}
	unchanged := trend.Update(nil, end.Add(150*time.Second))["network"]
	if len(unchanged.Points) != 0 || len(unchanged.RemovedIDs) != 0 {
		t.Fatal("unchanged window resent", unchanged)
	}
	expired := trend.Update(nil, end.Add(20*time.Minute))["network"]
	if len(expired.Points) != 0 || len(expired.RemovedIDs) != 120 {
		t.Fatal("expiration not sent", expired)
	}
}

func TestMetricTrendsReplacesMatchingHistoryAndBoundsCatchup(t *testing.T) {
	end := time.Date(2026, 11, 13, 0, 10, 0, 0, time.UTC)
	trend, _ := NewMetricTrendWindows(History{PeriodSeconds: 30}, end.Add(-LiveWindow), end)
	delta := trend.Update([]TelemetryLivePoint{{Group: "fast", Sequence: 1, At: end.Add(-time.Second)}}, end)["network"]
	if len(delta.RemovedIDs) != 2 || len(delta.Points) != 1 {
		t.Fatal("history replacement or expiry missing", delta)
	}
	batch := []TelemetryLivePoint{}
	for i := 0; i < 300; i++ {
		batch = append(batch, TelemetryLivePoint{Group: "fast", Sequence: uint64(i + 2), At: end.Add(time.Duration(i) * time.Second)})
	}
	delta = trend.Update(batch, end.Add(300*time.Second))["network"]
	if len(delta.Points) != 120 || len(trend.Snapshot()["network"].Points) != 120 {
		t.Fatal("catchup exceeds budget", len(delta.Points))
	}
}

func TestMetricTrendsIndependentGroupsAndHistorySemantics(t *testing.T) {
	end := time.Date(2026, 11, 13, 0, 12, 0, 0, time.UTC)
	at := end.Add(-180 * time.Second)
	stamp := uint64(at.UnixMilli())
	b := Bucket{Start: at.Unix(), CPU: Mean{Sum: ptr(60), Count: 3}, RAMUsed: Mean{Sum: ptr(100), Count: 2}, RAMTotal: valuePtr(uint64(200)), MemoryAt: &stamp, Load1: ptr(2), LoadAt: &stamp, DiskUsed: valuePtr(uint64(1)), DiskAvailable: valuePtr(uint64(2)), DiskAt: &stamp, ProcessCount: Peak{Max: ptr(7), Count: 2}}
	trend, initial := NewMetricTrendWindows(History{PeriodSeconds: 30, Points: []Bucket{b}}, end.Add(-LiveWindow), end)
	for key, w := range initial {
		if !w.Reset || len(w.Points) > 120 {
			t.Fatal(key, w)
		}
	}
	for key, want := range map[string]float64{"cpu": 20, "memory": 25, "load": 2, "disk": 34, "processes": 7} {
		series := key
		if key == "load" {
			series = "load_one"
		}
		found := false
		for _, p := range initial[key].Points {
			if p.At.Equal(at) {
				found = true
				if p.Values[series] == nil || *p.Values[series] != want {
					t.Fatal(key, p)
				}
			}
		}
		if !found {
			t.Fatal("missing bucket", key)
		}
	}
	full := TelemetryLivePoint{Sequence: 1, Group: "full", At: end, Values: map[string]float64{"load_1": 0, "disk_percent": 42}}
	trend.Update([]TelemetryLivePoint{full}, end)
	for i := 2; i <= 152; i++ {
		at := end.Add(time.Duration(i) * time.Second)
		trend.Update([]TelemetryLivePoint{{Sequence: uint64(i), Group: "fast", At: at, Values: map[string]float64{"cpu_percent": 1}}}, at)
	}
	snap := trend.Snapshot()
	if len(snap["cpu"].Points) != 120 {
		t.Fatal("CPU not bounded")
	}
	found := false
	for _, p := range snap["load"].Points {
		if p.ID == "l:1" {
			found = true
			if *p.Values["load_one"] != 0 {
				t.Fatal(p)
			}
		}
	}
	if !found {
		t.Fatal("fast points evicted full sample")
	}
	delta := trend.Update([]TelemetryLivePoint{{Sequence: 153, Group: "full", At: end.Add(200 * time.Second)}}, end.Add(200*time.Second))
	if len(delta["load"].Points) != 2 || delta["load"].Points[0].Values["load_one"] != nil {
		t.Fatal("outage not marked", delta["load"])
	}
	if len(trend.Update(nil, end.Add(200*time.Second))["load"].Points) != 0 {
		t.Fatal("gap resent")
	}
}
