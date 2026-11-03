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

	"github.com/coder/websocket"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/monitoring"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func TestTelemetryWSSReadyAndHTTPDedup(t *testing.T) {
	f := setup(t, "admin")
	node, key := f.enroll()
	token := f.token(node, key)
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	recorder, err := monitoring.NewTelemetryRecorder(ctx, f.store, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	ingress := monitoring.NewTelemetryIngress(recorder)
	f.gate.SetRecorder(recorder)
	f.gate.ConfigureTelemetry(ingress)
	server := httptest.NewTLSServer(NewRouter(Dependencies{Agents: f.agents, Gateway: f.gate, Telemetry: ingress}))
	defer server.Close()
	c, _, err := websocket.Dial(ctx, "wss"+strings.TrimPrefix(server.URL, "https")+"/api/v1/agents/ws", &websocket.DialOptions{HTTPClient: server.Client(), HTTPHeader: http.Header{"Authorization": []string{"Bearer " + token}}})
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	send(tWriter{t, c}, v1.Message("system.hello", node, auth.Random(), v1.Hello{ProtocolVersions: []string{v1.Version}, Capabilities: []string{v1.TelemetryCapability, "node.inventory.v1"}}))
	if e := receive(t, c); e.Type != "system.hello_ack" {
		t.Fatal(e.Type)
	}
	ready := receive(t, c)
	var settings v1.TelemetryReady
	if ready.Type != "node.telemetry.ready" || v1.DecodeTelemetry(ready.Payload, &settings, false) != nil || settings.Settings == nil {
		t.Fatal(ready)
	}
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
	now := time.Now().UTC()
	batch.Fast[0].SampledAt = now
	batch.Full[0].SampledAt = now
	post := func() (int, string) {
		t.Helper()
		raw, _ := json.Marshal(batch)
		req, _ := http.NewRequestWithContext(ctx, "POST", server.URL+"/api/v1/agents/metrics", strings.NewReader(string(raw)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)
		res, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return res.StatusCode, read(res)
	}
	if status, body := post(); status != 409 {
		t.Fatal("upload enabled before applied", status, body)
	}
	result := v1.Message("node.settings.v3_result", node, auth.Random(), v1.TelemetrySettingsResult{Revision: settings.Settings.Revision, AppliedRevision: settings.Settings.Revision, State: "applied"})
	result.CorrelationID = ready.MessageID
	send(tWriter{t, c}, result)
	message := v1.Message("node.metrics.v3", node, auth.Random(), batch)
	send(tWriter{t, c}, message)
	response := receive(t, c)
	var receipt v1.TelemetryReceipt
	if response.Type != "node.metrics.receipt" || v1.DecodeTelemetry(response.Payload, &receipt, false) != nil || receipt.State != "rejected" || receipt.ErrorCode != "stale_demand" || receipt.AcceptedCount != 0 {
		t.Fatal("WSS admitted without lease", response, receipt)
	}
	subscription, err := f.gate.SubscribeTelemetry([]string{node})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { subscription.Close(time.Now()) }()
	demandMessage := receive(t, c)
	var demand v1.TelemetryDemand
	if demandMessage.Type != "node.metrics.demand" || v1.DecodeTelemetry(demandMessage.Payload, &demand, false) != nil || demand.Validate(settings.SessionGeneration) != nil {
		t.Fatal("missing lease", demandMessage)
	}
	demandResult := v1.Message("node.metrics.demand_result", node, auth.Random(), v1.TelemetryDemandResult{SessionGeneration: settings.SessionGeneration, DemandRevision: demand.DemandRevision, LeaseID: demand.LeaseID, State: "applied", Mode: "realtime"})
	demandResult.CorrelationID = demandMessage.MessageID
	send(tWriter{t, c}, demandResult)
	send(tWriter{t, c}, message)
	response = receive(t, c)
	receipt = v1.TelemetryReceipt{}
	if response.Type != "node.metrics.receipt" || response.CorrelationID != message.MessageID || v1.DecodeTelemetry(response.Payload, &receipt, false) != nil || receipt.AcceptedCount != 2 {
		t.Fatal(response, receipt)
	}
	// Periodic asset updates must persist independently of telemetry.
	inventory := v1.NodeInventory{SampledAt: time.Now().UTC(), OSID: "ubuntu", OSName: "asset inventory", OSVersion: "24.04", PublicIpv4: "8.8.8.8", Errors: []string{"public_ipv6_unavailable"}}
	send(tWriter{t, c}, v1.Message("node.inventory", node, auth.Random(), inventory))
	// Same socket ordering: the next receipt proves inventory handling finished.
	send(tWriter{t, c}, message)
	if response = receive(t, c); response.Type != "node.metrics.receipt" {
		t.Fatal(response.Type)
	}
	persisted, err := f.store.Node(ctx, node)
	if err != nil || persisted.Inventory == nil || persisted.Inventory.OSName != inventory.OSName {
		t.Fatal("asset inventory was lost", err)
	}
	if status, body := post(); status != 200 || json.Unmarshal([]byte(body), &receipt) != nil || receipt.DuplicateCount != 2 {
		t.Fatal(status, body)
	}
	next := *settings.Settings
	next.CollectionSeconds = 60
	next.HttpReportSeconds = 30
	next = decodeResponse[v1.TelemetrySettings](t, f.request("PUT", "/api/v1/nodes/"+node+"/telemetry-settings", next, true), 200)
	update := receive(t, c)
	if update.Type != "node.settings.v3" {
		t.Fatal(update.Type)
	}
	result = v1.Message("node.settings.v3_result", node, auth.Random(), v1.TelemetrySettingsResult{Revision: next.Revision, AppliedRevision: next.Revision, State: "applied"})
	result.CorrelationID = update.MessageID
	send(tWriter{t, c}, result)
	send(tWriter{t, c}, message)
	if response = receive(t, c); response.Type != "node.metrics.receipt" {
		t.Fatal(response.Type)
	}
	if err = recorder.Flush(ctx, time.Now(), true); err != nil {
		t.Fatal(err)
	}
	history, err := f.store.MetricHistory(ctx, node, now.Add(-time.Minute), now.Add(time.Minute), 30)
	if err != nil || len(history.Points) != 1 || history.Points[0].CPU.Count != 1 {
		t.Fatal(history, err)
	}
	c.CloseNow()
	// Management disconnect does not revoke the negotiated bearer upload path.
	if status, body := post(); status != 200 {
		t.Fatal(status, body)
	}
}

func TestTelemetrySSEScopeActivatesGatewayLease(t *testing.T) {
	f := setup(t, "admin")
	node, key := f.enroll()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	recorder, err := monitoring.NewTelemetryRecorder(ctx, f.store, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	f.gate.ConfigureTelemetry(monitoring.NewTelemetryIngress(recorder))
	first := f.request("GET", "/api/v1/metrics/events?node="+node, nil, true)
	defer first.Body.Close()
	firstReader := bufio.NewReader(first.Body)
	metricFrame(t, firstReader)
	second := f.request("GET", "/api/v1/metrics/events?node="+node, nil, true)
	defer second.Body.Close()
	metricFrame(t, bufio.NewReader(second.Body))
	c, _, err := websocket.Dial(ctx, "wss"+strings.TrimPrefix(f.server.URL, "https")+"/api/v1/agents/ws", &websocket.DialOptions{HTTPClient: f.server.Client(), HTTPHeader: http.Header{"Authorization": []string{"Bearer " + f.token(node, key)}}})
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	send(tWriter{t, c}, v1.Message("system.hello", node, auth.Random(), v1.Hello{ProtocolVersions: []string{v1.Version}, Capabilities: []string{v1.TelemetryCapability}}))
	if receive(t, c).Type != "system.hello_ack" {
		t.Fatal("missing hello ack")
	}
	ready := receive(t, c)
	var settings v1.TelemetryReady
	if ready.Type != "node.telemetry.ready" || v1.DecodeTelemetry(ready.Payload, &settings, false) != nil {
		t.Fatal("ready")
	}
	result := v1.Message("node.settings.v3_result", node, auth.Random(), v1.TelemetrySettingsResult{Revision: settings.Settings.Revision, AppliedRevision: settings.Settings.Revision, State: "applied"})
	result.CorrelationID = ready.MessageID
	send(tWriter{t, c}, result)
	command := receive(t, c)
	var demand v1.TelemetryDemand
	if command.Type != "node.metrics.demand" || v1.DecodeTelemetry(command.Payload, &demand, false) != nil || demand.Validate(settings.SessionGeneration) != nil || !demand.Enabled || demand.DemandRevision != 1 {
		t.Fatalf("SSE did not activate lease: %+v", command)
	}
	if f.gate.TelemetryDemand(node).References != 2 {
		t.Fatal("scope references changed during negotiation")
	}
	waitMode := func(want string) {
		t.Helper()
		for i := 0; i < 5; i++ {
			value := metricFrame(t, firstReader).Items[node]
			if value.TelemetryControl != nil && value.TelemetryControl.Mode == want {
				return
			}
		}
		t.Fatalf("SSE did not show %s", want)
	}
	waitMode("pending")
	receipt := v1.Message("node.metrics.demand_result", node, auth.Random(), v1.TelemetryDemandResult{SessionGeneration: settings.SessionGeneration, DemandRevision: demand.DemandRevision, LeaseID: demand.LeaseID, State: "applied", Mode: "realtime"})
	receipt.CorrelationID = command.MessageID
	send(tWriter{t, c}, receipt)
	waitMode("realtime")
	// A supported subsequent settings operation proves the demand receipt was
	// accepted by the real gateway rather than terminating the management link.
	next := *settings.Settings
	next.CollectionSeconds = 2
	decodeResponse[v1.TelemetrySettings](t, f.request("PUT", "/api/v1/nodes/"+node+"/telemetry-settings", next, true), 200)
	if update := receive(t, c); update.Type != "node.settings.v3" {
		t.Fatalf("management lost after demand result: %s", update.Type)
	}
	awaitReferences := func(want int) monitoring.DemandState {
		t.Helper()
		tick := time.NewTicker(10 * time.Millisecond)
		defer tick.Stop()
		for {
			state := f.gate.TelemetryDemand(node)
			if state.References == want {
				return state
			}
			select {
			case <-ctx.Done():
				t.Fatalf("SSE references=%d want=%d", state.References, want)
			case <-tick.C:
			}
		}
	}
	first.Body.Close()
	if state := awaitReferences(1); !state.GraceUntil.IsZero() {
		t.Fatal("closing one viewer started final-viewer grace", state)
	}
	second.Body.Close()
	if state := awaitReferences(0); !state.GraceUntil.After(time.Now()) || state.GraceUntil.After(time.Now().Add(15*time.Second)) {
		t.Fatal("last real SSE did not enter bounded grace", state)
	}
}
