package httpapi

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/vioira/viorka/internal/monitoring"
)

func TestBrowserNetworkTrendInitialHistory(t *testing.T) {
	f := setup(t, "admin")
	node, _ := f.enroll()
	c := browserTestSocket(t, f)
	browserSend(t, c, browserMessage{Type: "subscribe", Node: node, Scope: "node=" + node + "&view=live", Generation: 1, Enabled: true})
	frame := browserReceive(t, c, "metrics", "")
	raw, _ := json.Marshal(frame.Data)
	var metrics MetricFrame
	if err := json.Unmarshal(raw, &metrics); err != nil {
		t.Fatal(err)
	}
	trend := metrics.Items[node].MetricTrends["network"]
	if !trend.Reset || len(trend.Points) > monitoring.MetricTrendLimit {
		t.Fatalf("missing bounded initial window: %s", raw)
	}
}

func TestNetworkProjectionOmitsCachedReplayAndSendsOnlyNewPoints(t *testing.T) {
	f := setup(t, "admin")
	node, _ := f.enroll()
	a := &api{Dependencies: Dependencies{History: f.store}}
	var state *monitoring.MetricTrendWindows
	point := monitoring.TelemetryLivePoint{Group: "fast", Sequence: 1, At: time.Now().UTC(), Values: map[string]float64{"rx_bytes_per_second": 42, "cpu_percent": 10}}
	value := monitoring.LiveSnapshot{Reset: true, Snapshot: monitoring.Snapshot{Telemetry: &monitoring.TelemetryLiveSnapshot{Points: []monitoring.TelemetryLivePoint{point}}}}
	initial, err := a.metricTrends(context.Background(), node, value, &state, true)
	if err != nil || len(initial.Telemetry.Points) != 0 {
		t.Fatal("replayed cached raw points", initial, err)
	}
	value.Reset = false
	point.Sequence = 2
	point.ReceivedAt = time.Now().UTC()
	value.Telemetry.Points = []monitoring.TelemetryLivePoint{point}
	next, err := a.metricTrends(context.Background(), node, value, &state, false)
	if err != nil || next.MetricTrends["network"].Reset || len(next.MetricTrends["network"].Points) != 1 || *next.MetricTrends["network"].Points[0].Values["rx"] != 42 {
		t.Fatal("missing delta", next, err)
	}
	if len(next.Telemetry.Points) != 0 || value.Telemetry.Points[0].Values["rx_bytes_per_second"] != 42 {
		t.Fatal("duplicated payload or source mutated")
	}
	value.Telemetry.Points = nil
	unchanged, err := a.metricTrends(context.Background(), node, value, &state, false)
	if err != nil || len(unchanged.MetricTrends["network"].Points) != 0 {
		t.Fatal("resent full window", unchanged, err)
	}
}

func TestMetricTrendHistoryRanges(t *testing.T) {
	f := setup(t, "admin")
	node, _ := f.enroll()
	for _, r := range []string{"10m", "1h", "6h", "24h", "2d", "7d"} {
		response := decodeResponse[MetricTrendHistory](t, f.request("GET", "/api/v1/nodes/"+node+"/metrics/trends?range="+r, nil, true), 200)
		if len(response.Charts) != 8 {
			t.Fatal("missing charts", r)
		}
		for key, chart := range response.Charts {
			if len(chart.Points) == 0 || len(chart.Points) > 120 || !chart.Reset {
				t.Fatal(r, key, chart)
			}
			for _, point := range chart.Points {
				if point.At.Unix()%int64(chart.PeriodSeconds) != 0 {
					t.Fatal("unaligned bucket", r, point)
				}
			}
		}
		if r == "7d" && (response.Charts["cpu"].PeriodSeconds != 5040 || len(response.Charts["cpu"].Points) != 120) {
			t.Fatal(response)
		}
	}
	for _, query := range []string{"range=bad", "range=1h&range=7d", "limit=1000"} {
		res := f.request("GET", "/api/v1/nodes/"+node+"/metrics/trends?"+query, nil, true)
		res.Body.Close()
		if res.StatusCode != 400 {
			t.Fatal(query, res.StatusCode)
		}
	}
	res := f.request("GET", "/api/v1/nodes/"+node+"/metrics/trends", nil, false)
	res.Body.Close()
	if res.StatusCode != 401 {
		t.Fatal(res.StatusCode)
	}
	res = f.request("GET", "/api/v1/nodes/missing/metrics/trends", nil, true)
	res.Body.Close()
	if res.StatusCode != 404 {
		t.Fatal(res.StatusCode)
	}
}
