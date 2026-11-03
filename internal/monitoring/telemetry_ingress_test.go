package monitoring

import (
	"context"
	"encoding/json"
	"errors"
	v1 "github.com/vioira/viorka/protocol/v1"
	"os"
	"strings"
	"testing"
	"time"
)

func ingressFixture(t *testing.T) (v1.TelemetryBatch, time.Time) {
	t.Helper()
	raw, err := os.ReadFile("../../api/agent/v1/examples/node.metrics.v3.json")
	if err != nil {
		t.Fatal(err)
	}
	var e struct {
		Payload v1.TelemetryBatch `json:"payload"`
	}
	if err = json.Unmarshal(raw, &e); err != nil {
		t.Fatal(err)
	}
	return e.Payload, e.Payload.Fast[0].SampledAt
}
func TestTelemetryIngressAtomicAdmissionAndDualChannelDedup(t *testing.T) {
	b, now := ingressFixture(t)
	ctx := context.Background()
	repo := &telemetryMemoryRepo{}
	recorder, err := NewTelemetryRecorder(ctx, repo, now)
	if err != nil {
		t.Fatal(err)
	}
	s := NewTelemetryIngress(recorder)
	session := strings.Repeat("a", 64)
	settings := v1.DefaultTelemetrySettings()
	raw, _ := json.Marshal(b)
	if _, err = s.Receive(ctx, b.NodeID, session, "", raw, true, now); !errors.Is(err, ErrTelemetrySession) {
		t.Fatal("unnegotiated upload", err)
	}
	if err = s.Activate(b.NodeID, session, "generation-1", now.Add(time.Hour), settings, now); err != nil {
		t.Fatal(err)
	}
	// A valid fast group followed by a contradictory full group changes neither
	// the active run nor any checkpoint. Correcting it must accept both groups.
	one := uint64(1)
	b.Full[0].Processes = &one
	invalid, _ := json.Marshal(b)
	if _, err = s.Receive(ctx, b.NodeID, session, "", invalid, true, now); err == nil {
		t.Fatal("bad late group accepted")
	}
	if recorder.nodes[b.NodeID] != nil || s.bindings[b.NodeID].run != "" {
		t.Fatal("invalid batch mutated state")
	}
	reply, err := s.Receive(ctx, b.NodeID, session, "", raw, true, now)
	if err != nil || reply.AcceptedCount != 2 || reply.DuplicateCount != 0 {
		t.Fatal(reply, err)
	}
	reply, err = s.Receive(ctx, b.NodeID, session, "generation-1", raw, false, now)
	if err != nil || reply.AcceptedCount != 0 || reply.DuplicateCount != 2 {
		t.Fatal("cross-channel duplicate", reply, err)
	}
	if err = recorder.Flush(ctx, now, true); err != nil {
		t.Fatal(err)
	}
	if len(repo.commits) != 1 || len(repo.commits[0]) != 1 || len(repo.commits[0][0].Checkpoints) != 2 {
		t.Fatal("unexpected persisted checkpoint state", repo.commits)
	}
	// Disconnect does not remove the binding: HTTP only needs the authenticated
	// session. Renewed management generation fences delayed WSS messages.
	if err = s.Activate(b.NodeID, session, "generation-2", now.Add(time.Hour), settings, now); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Receive(ctx, b.NodeID, session, "generation-1", raw, false, now); !errors.Is(err, ErrTelemetrySession) {
		t.Fatal(err)
	}
	if _, err = s.Receive(ctx, b.NodeID, session, "", raw, true, now); err != nil {
		t.Fatal(err)
	}
	b.Full[0].Processes = nil
	b.RunID = "22222222-2222-4222-8222-222222222222"
	other, _ := json.Marshal(b)
	if _, err = s.Receive(ctx, b.NodeID, session, "", other, true, now); !errors.Is(err, ErrTelemetryRun) {
		t.Fatal("run switched inside session", err)
	}
	if _, err = s.Receive(ctx, b.NodeID, session, "", raw, true, now.Add(time.Hour)); !errors.Is(err, ErrTelemetrySession) {
		t.Fatal("expired", err)
	}
	s.Forget(b.NodeID)
	if _, err = s.Receive(ctx, b.NodeID, session, "", raw, true, now); !errors.Is(err, ErrTelemetrySession) {
		t.Fatal("forgotten", err)
	}
}

func TestTelemetryIngressSharedBudgetAndCancellation(t *testing.T) {
	b, now := ingressFixture(t)
	ctx := context.Background()
	r, err := NewTelemetryRecorder(ctx, &telemetryMemoryRepo{}, now)
	if err != nil {
		t.Fatal(err)
	}
	s := NewTelemetryIngress(r)
	session := strings.Repeat("a", 64)
	if err = s.Activate(b.NodeID, session, "generation", now.Add(time.Hour), v1.DefaultTelemetrySettings(), now); err != nil {
		t.Fatal(err)
	}
	// Malformed requests consume the same budget through either channel.
	for i := 0; i < 32; i++ {
		if _, err = s.Receive(ctx, b.NodeID, session, "generation", []byte("{}"), i%2 == 0, now); err == nil || errors.Is(err, ErrTelemetryRate) {
			t.Fatal(i, err)
		}
	}
	raw, _ := json.Marshal(b)
	if _, err = s.Receive(ctx, b.NodeID, session, "", raw, true, now); !errors.Is(err, ErrTelemetryRate) {
		t.Fatal(err)
	}
	if _, err = s.Receive(ctx, b.NodeID, session, "", raw, true, now.Add(time.Second)); err != nil {
		t.Fatal("budget recovery", err)
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err = s.Receive(cancelled, b.NodeID, session, "", raw, true, now); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}
