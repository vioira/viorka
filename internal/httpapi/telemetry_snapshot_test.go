package httpapi

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/monitoring"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func TestTelemetryOfflinePOSTFeedsRESTAndSSE(t *testing.T) {
	f := setup(t, "admin")
	node, key := f.enroll()
	token := f.token(node, key)
	now := time.Now().UTC()
	ctx := context.Background()
	recorder, err := monitoring.NewTelemetryRecorder(ctx, f.store, now)
	if err != nil {
		t.Fatal(err)
	}
	ingress := monitoring.NewTelemetryIngress(recorder)
	f.gate.ConfigureTelemetry(ingress)
	settings := v1.DefaultTelemetrySettings()
	if err = ingress.Activate(node, auth.Hash(token), "generation", now.Add(15*time.Minute), settings, now); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewTLSServer(NewRouter(Dependencies{Agents: f.agents, Gateway: f.gate, Telemetry: ingress}))
	defer server.Close()
	stream := f.request("GET", "/api/v1/metrics/events?node="+node, nil, true)
	defer stream.Body.Close()
	reader := bufio.NewReader(stream.Body)
	metricFrame(t, reader)
	raw, err := os.ReadFile("../../api/agent/v1/examples/node.metrics.v3.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Payload v1.TelemetryBatch `json:"payload"`
	}
	if err = json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	batch := fixture.Payload
	batch.NodeID = node
	batch.Fast[0].SampledAt = now
	batch.Full[0].SampledAt = now
	post := func() v1.TelemetryReceipt {
		t.Helper()
		raw, err := json.Marshal(batch)
		if err != nil {
			t.Fatal(err)
		}
		request, err := http.NewRequest("POST", server.URL+"/api/v1/agents/metrics", strings.NewReader(string(raw)))
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Authorization", "Bearer "+token)
		request.Header.Set("Content-Type", "application/json")
		response, err := server.Client().Do(request)
		if err != nil {
			t.Fatal(err)
		}
		return decodeResponse[v1.TelemetryReceipt](t, response, 200)
	}
	if receipt := post(); receipt.AcceptedCount != 2 {
		t.Fatal(receipt)
	}
	frame := metricFrame(t, reader)
	live := frame.Items[node]
	if live.Telemetry == nil || live.ManagementOnline || live.Stale || live.Telemetry.FastStale || len(live.Telemetry.Points) != 1 {
		t.Fatalf("fresh offline POST not exposed independently: %+v", live)
	}
	if live.Telemetry.Fast.Interfaces[0].RXBytes != "9007199254740993" || live.TelemetryControl == nil || live.TelemetryControl.Mode != "http" || live.TelemetryControl.References != 1 {
		t.Fatal("exact counters/control status missing")
	}
	originalGroupReceived := live.Telemetry.FastReceivedAt
	snapshot := decodeResponse[monitoring.Snapshot](t, f.request("GET", "/api/v1/nodes/"+node+"/metrics", nil, true), 200)
	if snapshot.ManagementOnline || snapshot.Stale || snapshot.Telemetry == nil {
		t.Fatal("REST conflates management and freshness")
	}
	if receipt := post(); receipt.DuplicateCount != 2 {
		t.Fatal("cross-request dedup", receipt)
	}
	delta := metricFrame(t, reader).Items[node]
	if delta.Reset || len(delta.Telemetry.Points) != 0 || !delta.Telemetry.FastReceivedAt.Equal(originalGroupReceived) {
		t.Fatal("duplicate created points or refreshed group time")
	}
	next := settings
	next.Revision++
	next.CollectionSeconds = 60
	next.HttpReportSeconds = 30
	if err = ingress.Activate(node, auth.Hash(token), "generation", now.Add(15*time.Minute), next, time.Now()); err != nil {
		t.Fatal(err)
	}
	updated := metricFrame(t, reader).Items[node]
	if updated.Telemetry.Settings == nil || *updated.Telemetry.Settings != next || len(updated.Telemetry.Points) != 0 {
		t.Fatal("applied settings did not update SSE without fabricating points")
	}
	summaryStream := f.request("GET", "/api/v1/metrics/events?through="+node, nil, true)
	defer summaryStream.Body.Close()
	summary := metricFrame(t, bufio.NewReader(summaryStream.Body)).Items[node]
	if summary.Telemetry == nil || len(summary.Telemetry.Points) != 0 || len(summary.Telemetry.Fast.Interfaces) != 0 || len(summary.Telemetry.Full.Filesystems) != 0 {
		t.Fatal("list summary leaked large arrays")
	}
	current, err := f.store.Node(ctx, node)
	if err != nil || current.State == "online" {
		t.Fatal("POST fabricated management presence", err)
	}
}
