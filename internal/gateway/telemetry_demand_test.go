package gateway

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/vioira/viorka/internal/monitoring"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func TestTelemetryDemandRenewalGraceAndReceipt(t *testing.T) {
	now := time.Now()
	s := &telemetrySession{applied: true, node: "node", generation: "generation"}
	var messages []v1.Envelope
	send := func(e v1.Envelope) error { messages = append(messages, e); return nil }
	push := func(refs int, grace, at time.Time) {
		t.Helper()
		if err := s.pushDemand(monitoring.DemandState{References: refs, GraceUntil: grace}, at, send); err != nil {
			t.Fatal(err)
		}
	}
	push(0, time.Time{}, now)
	if len(messages) != 0 {
		t.Fatal("no viewers activated realtime")
	}
	push(1, time.Time{}, now)
	if s.demand.mode != "pending" || s.demand.revision != 1 {
		t.Fatal("send falsely reported applied")
	}
	var command v1.TelemetryDemand
	if err := v1.DecodeTelemetry(messages[0].Payload, &command, false); err != nil || command.Validate("generation") != nil || command.TtlSeconds != 90 {
		t.Fatal("lease contract", err)
	}
	result := v1.Message("node.metrics.demand_result", "node", "reply", v1.TelemetryDemandResult{SessionGeneration: "generation", DemandRevision: 1, LeaseID: command.LeaseID, State: "applied", Mode: "realtime"})
	result.CorrelationID = messages[0].MessageID
	if err := s.demandResult(result, now.Add(time.Second)); err != nil || s.demand.mode != "realtime" {
		t.Fatal("mode receipt", err)
	}
	push(2, time.Time{}, now.Add(29*time.Second))
	if len(messages) != 1 {
		t.Fatal("additional viewer duplicated stream")
	}
	push(2, time.Time{}, now.Add(30*time.Second))
	if len(messages) != 2 || s.demand.revision != 2 {
		t.Fatal("renewal")
	}
	if err := s.demandResult(result, now.Add(31*time.Second)); err != nil || s.demand.mode != "pending" {
		t.Fatal("old receipt regressed new command")
	}
	grace := now.Add(65 * time.Second)
	push(0, grace, now.Add(60*time.Second))
	if len(messages) != 2 {
		t.Fatal("renewed without viewers")
	}
	push(0, grace, grace)
	if len(messages) != 3 || s.demand.enabled {
		t.Fatal("grace did not disable")
	}
	push(0, grace, grace.Add(15*time.Second))
	if s.demand.mode != "degraded" {
		t.Fatal("lost ACK shown as applied")
	}
	push(0, grace, grace.Add(30*time.Second))
	if len(messages) != 4 || s.demand.revision != 4 {
		t.Fatal("disable retry missing")
	}
	if err := v1.DecodeTelemetry(messages[3].Payload, &command, false); err != nil {
		t.Fatal(err)
	}
	result = v1.Message("node.metrics.demand_result", "node", "reply", v1.TelemetryDemandResult{SessionGeneration: "generation", DemandRevision: 4, LeaseID: command.LeaseID, State: "applied", Mode: "http"})
	result.CorrelationID = messages[3].MessageID
	if err := s.demandResult(result, grace.Add(31*time.Second)); err != nil {
		t.Fatal(err)
	}
	push(0, grace, grace.Add(time.Minute))
	if len(messages) != 4 {
		t.Fatal("acknowledged disable repeated")
	}
}

func TestTelemetryDemandAdmissionDeadline(t *testing.T) {
	now := time.Now()
	s := &telemetrySession{}
	if s.demandError(now) != "stale_demand" {
		t.Fatal("absent lease allowed")
	}
	s.demand = telemetryDemandState{revision: 1, enabled: true, sentAt: now}
	if s.demandError(now.Add(90*time.Second-time.Nanosecond)) != "" {
		t.Fatal("live lease rejected")
	}
	if s.demandError(now.Add(90*time.Second)) != "lease_expired" {
		t.Fatal("expired lease allowed")
	}
	s.demand.enabled = false
	if s.demandError(now) != "stale_demand" {
		t.Fatal("disabled lease allowed")
	}
}

type tcpProbeSettingsRepo struct{}

func (tcpProbeSettingsRepo) TelemetrySettings(context.Context, string) (v1.TelemetrySettings, error) {
	return v1.DefaultTelemetrySettings(), nil
}
func (tcpProbeSettingsRepo) RecordTelemetrySettingsResult(context.Context, string, v1.TelemetrySettingsResult) error {
	return nil
}
func TestTCPProbeReadyCompatibility(t *testing.T) {
	for _, supported := range []bool{false, true} {
		session := &telemetrySession{repo: tcpProbeSettingsRepo{}, node: "node", generation: "generation", tcpProbeSupported: supported}
		var ready map[string]json.RawMessage
		if err := session.push(context.Background(), func(e v1.Envelope) error { return json.Unmarshal(e.Payload, &ready) }, true); err != nil {
			t.Fatal(err)
		}
		value, present := ready["tcp_probe"]
		if present != supported || (supported && string(value) != "true") {
			t.Fatalf("capability %t: %s", supported, value)
		}
	}
}
