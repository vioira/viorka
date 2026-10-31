package httpapi

import (
	"context"
	"encoding/json"
	"github.com/coder/websocket"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/monitoring"
	v1 "github.com/vioira/viorka/protocol/v1"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestBatchMetricsPersistedHistory(t *testing.T) {
	f := setup(t, "admin")
	node, key := f.enroll()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	recorder, err := monitoring.NewRecorder(ctx, f.store)
	if err != nil {
		t.Fatal(err)
	}
	f.gate.SetRecorder(recorder)
	c, _, err := websocket.Dial(ctx, "wss"+strings.TrimPrefix(f.server.URL, "https")+"/api/v1/agents/ws", &websocket.DialOptions{HTTPClient: f.server.Client(), HTTPHeader: http.Header{"Authorization": []string{"Bearer " + f.token(node, key)}}})
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	send(tWriter{t, c}, v1.Message("system.hello", node, auth.Random(), v1.Hello{ProtocolVersions: []string{v1.Version}, Capabilities: []string{"node.metrics.v2", "node.settings.v2"}}))
	ack := receive(t, c)
	var h v1.HelloAck
	if v1.Decode(ack.Payload, &h) != nil || h.MetricsVersion == nil || *h.MetricsVersion != 2 || h.CollectionSettings == nil || h.CollectionSettings.WssReportSeconds != 2 {
		t.Fatalf("negotiation %+v", h)
	}
	at := time.Now().UTC().Truncate(time.Minute).Add(-time.Minute)
	v := 20.0
	sample := v1.NodeMetrics{SampledAt: at, IntervalSeconds: 1, CPU: &v1.CPUMetrics{LogicalCPUs: 1, UsagePercent: &v}, Errors: []string{"memory_unavailable", "load_unavailable", "disk_unavailable", "uptime_unavailable", "network_unavailable"}, Interfaces: []*v1.InterfaceMetrics{}}
	other := sample
	other.SampledAt = at.Add(time.Second)
	value := 80.0
	other.CPU = &v1.CPUMetrics{LogicalCPUs: 1, UsagePercent: &value}
	send(tWriter{t, c}, v1.Message("node.metrics_batch", node, auth.Random(), v1.NodeMetricsBatch{Samples: []*v1.NodeMetrics{&sample, &other}}))
	for f.gate.Metrics(node, false).Latest == nil {
		select {
		case <-ctx.Done():
			t.Fatal("metrics not accepted")
		case <-time.After(time.Millisecond):
		}
	}
	// Wait for the final sample, not just the first item in the batch.
	for !f.gate.Metrics(node, false).Latest.SampledAt.Equal(other.SampledAt) {
		select {
		case <-ctx.Done():
			t.Fatal("batch incomplete")
		case <-time.After(time.Millisecond):
		}
	}
	if err = recorder.Flush(ctx, time.Now(), true); err != nil {
		t.Fatal(err)
	}
	for _, rangeValue := range []string{"1h", "6h", "24h", "7d"} {
		res := f.request("GET", "/api/v1/nodes/"+node+"/metrics/history?range="+rangeValue, nil, true)
		if res.StatusCode != 200 {
			t.Fatal(read(res))
		}
		var hist monitoring.History
		err = json.NewDecoder(res.Body).Decode(&hist)
		res.Body.Close()
		if err != nil || len(hist.Points) != 1 || hist.Points[0].Stats["cpu"].Count != 2 || hist.Points[0].Stats["cpu"].Sum != 100 {
			t.Fatalf("history %+v %v", hist, err)
		}
	}
	expectStatus(t, f.request("GET", "/api/v1/nodes/"+node+"/metrics/history?range=30d", nil, true), 400)
	expectStatus(t, f.request("GET", "/api/v1/nodes/"+node+"/metrics/history", nil, false), 401)
	expectStatus(t, f.request("GET", "/api/v1/nodes/missing/metrics/history", nil, true), 404)
}
func TestLegacySettingsNotReinterpreted(t *testing.T) {
	f := setup(t, "admin")
	node, key := f.enroll()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "wss"+strings.TrimPrefix(f.server.URL, "https")+"/api/v1/agents/ws", &websocket.DialOptions{HTTPClient: f.server.Client(), HTTPHeader: http.Header{"Authorization": []string{"Bearer " + f.token(node, key)}}})
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	send(tWriter{t, c}, v1.Message("system.hello", node, auth.Random(), v1.Hello{ProtocolVersions: []string{v1.Version}, Capabilities: []string{"node.settings.v1", "node.metrics.v1"}}))
	ack := receive(t, c)
	var h v1.HelloAck
	if v1.Decode(ack.Payload, &h) != nil || h.CollectionSettings != nil || h.NodeSettings != nil || h.MetricsVersion == nil || *h.MetricsVersion != 1 {
		t.Fatalf("legacy handshake %+v", h)
	}
}
