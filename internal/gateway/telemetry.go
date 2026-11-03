package gateway

import (
	"context"
	"errors"
	"reflect"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/monitoring"
	"github.com/vioira/viorka/internal/realtime"
	v1 "github.com/vioira/viorka/protocol/v1"
)

type telemetryRepository interface {
	TelemetrySettings(context.Context, string) (v1.TelemetrySettings, error)
	RecordTelemetrySettingsResult(context.Context, string, v1.TelemetrySettingsResult) error
}

// ConfigureTelemetry wires the telemetry ingress before accepting connections.
func (g *Gateway) ConfigureTelemetry(ingress *monitoring.TelemetryIngress) {
	g.telemetry = ingress
	ingress.SetNotifier(func(node string) {
		if g.events != nil {
			g.events.Publish(realtime.Change{Kind: "metrics", NodeID: node})
		}
	})
}

type telemetrySession struct {
	trafficSupported                 bool
	demand                           telemetryDemandState
	ingress                          *monitoring.TelemetryIngress
	repo                             telemetryRepository
	node, token, generation, pending string
	expires, pendingAt               time.Time
	settings                         v1.TelemetrySettings
	applied                          bool
}

func (t *telemetrySession) push(ctx context.Context, send func(v1.Envelope) error, initial bool) error {
	settings, err := t.repo.TelemetrySettings(ctx, t.node)
	if err != nil {
		return err
	}
	if err = settings.Validate(); err != nil {
		return err
	}
	if settings.Traffic != nil && !t.trafficSupported {
		return errors.New("agent does not support traffic settings")
	}
	if !initial && reflect.DeepEqual(settings, t.settings) {
		return nil
	}
	kind := "node.settings.v3"
	var payload any = settings
	if initial {
		kind = "node.telemetry.ready"
		payload = v1.TelemetryReady{SessionGeneration: t.generation, Settings: &settings}
	}
	message := v1.Message(kind, t.node, auth.Random(), payload)
	if err = send(message); err != nil {
		return err
	}
	t.settings = settings
	t.pending = message.MessageID
	t.pendingAt = time.Now()
	return nil
}
func (t *telemetrySession) result(ctx context.Context, e v1.Envelope) error {
	if e.Revision != nil || e.CorrelationID == "" || v1.ValidateTelemetryJSON(e.Payload, "TelemetrySettingsResult", false) != nil {
		return v1.ErrTelemetryPayload
	}
	var result v1.TelemetrySettingsResult
	if v1.DecodeTelemetry(e.Payload, &result, false) != nil || result.Validate() != nil {
		return v1.ErrTelemetryPayload
	}
	if e.CorrelationID != t.pending {
		return nil
	}
	if result.Revision != t.settings.Revision {
		return v1.ErrTelemetryPayload
	}
	if err := t.repo.RecordTelemetrySettingsResult(ctx, t.node, result); err != nil {
		return err
	}
	t.pending = ""
	if result.State != "applied" {
		return nil
	}
	if err := t.ingress.Activate(t.node, auth.Hash(t.token), t.generation, t.expires, t.settings, time.Now()); err != nil {
		return err
	}
	t.applied = true
	return nil
}
func (t *telemetrySession) receive(ctx context.Context, a *auth.Agents, e v1.Envelope, send func(v1.Envelope) error) error {
	if !t.applied || e.Revision != nil || e.CorrelationID != "" {
		return v1.ErrTelemetryPayload
	}
	node, _, err := a.Authenticate(ctx, t.token)
	if err != nil {
		return err
	}
	if node != t.node {
		return auth.ErrUnauthorized
	}
	now := time.Now()
	if code := t.demandError(now); code != "" {
		// This path is included in the management message budget; invalid
		// leases cannot bypass rate limits by avoiding the shared ingress.
		batch, err := v1.DecodeTelemetryBatch(e.Payload, t.node, now, t.settings.HttpReportSeconds, false)
		if err != nil {
			return err
		}
		reply := v1.Message("node.metrics.receipt", t.node, auth.Random(), v1.TelemetryReceipt{BatchID: batch.BatchID, State: "rejected", ErrorCode: code})
		reply.CorrelationID = e.MessageID
		return send(reply)
	}
	receipt, err := t.ingress.Receive(ctx, t.node, auth.Hash(t.token), t.generation, e.Payload, false, now)
	if err != nil {
		if receipt.BatchID == "" {
			return err
		}
		receipt.ErrorCode = "invalid_batch"
		switch {
		case errors.Is(err, monitoring.ErrTelemetryRun), errors.Is(err, monitoring.ErrTelemetrySession):
			receipt.ErrorCode = "stale_session"
		case errors.Is(err, monitoring.ErrTelemetryOverloaded):
			receipt.ErrorCode = "overloaded"
		case errors.Is(err, monitoring.ErrTelemetryRate):
			receipt.ErrorCode = "rate_limited"
		}
	}
	reply := v1.Message("node.metrics.receipt", t.node, auth.Random(), receipt)
	reply.CorrelationID = e.MessageID
	return send(reply)
}

// NotifyTelemetrySettings does not disturb management-only connections when an
// administrator prepares v3 desired settings for a future Agent upgrade.
func (g *Gateway) NotifyTelemetrySettings(node string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if !g.telemetryNodes[node] {
		return
	}
	if wake := g.settingsWake[node]; wake != nil {
		select {
		case wake <- struct{}{}:
		default:
		}
	}
}
