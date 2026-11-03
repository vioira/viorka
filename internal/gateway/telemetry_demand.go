package gateway

import (
	"fmt"
	"math"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/monitoring"
	v1 "github.com/vioira/viorka/protocol/v1"
)

type telemetryDemandState struct {
	revision             uint64
	lease, pending, mode string
	enabled              bool
	sentAt               time.Time
}

func (g *Gateway) SubscribeTelemetry(nodes []string) (*monitoring.DemandSubscription, error) {
	return g.demands.Subscribe(nodes, time.Now())
}
func (g *Gateway) notifyDemand(node string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if !g.telemetryNodes[node] {
		return
	}
	if wake := g.demandWake[node]; wake != nil {
		select {
		case wake <- struct{}{}:
		default:
		}
	}
}
func (t *telemetrySession) pushDemand(scope monitoring.DemandState, now time.Time, send func(v1.Envelope) error) error {
	if !t.applied {
		return nil
	}
	d := &t.demand
	if d.pending != "" && !now.Before(d.sentAt.Add(15*time.Second)) {
		d.mode = "degraded"
	}
	enabled := scope.References > 0 || (d.enabled && now.Before(scope.GraceUntil))
	if d.revision == 0 && !enabled {
		return nil
	}
	if enabled == d.enabled {
		// During last-viewer grace keep the old lease, but never renew it.
		if !enabled {
			if d.pending == "" && d.mode == "http" {
				return nil
			}
			if now.Before(d.sentAt.Add(30 * time.Second)) {
				return nil
			}
		} else if scope.References == 0 || now.Before(d.sentAt.Add(30*time.Second)) {
			return nil
		}
	}
	if d.revision >= math.MaxInt64 {
		return fmt.Errorf("telemetry demand revision exhausted")
	}
	if d.lease == "" {
		d.lease = auth.Random()
	}
	next := v1.TelemetryDemand{SessionGeneration: t.generation, DemandRevision: d.revision + 1, LeaseID: d.lease, Enabled: enabled}
	if enabled {
		next.TtlSeconds = 90
	}
	msg := v1.Message("node.metrics.demand", t.node, auth.Random(), next)
	if err := send(msg); err != nil {
		return err
	}
	d.revision = next.DemandRevision
	d.pending = msg.MessageID
	d.enabled = enabled
	d.sentAt = now
	d.mode = "pending"
	return nil
}
func (t *telemetrySession) demandResult(e v1.Envelope, now time.Time) error {
	if !t.applied || e.Revision != nil || e.CorrelationID == "" || v1.ValidateTelemetryJSON(e.Payload, "TelemetryDemandResult", false) != nil {
		return fmt.Errorf("invalid telemetry demand result")
	}
	var result v1.TelemetryDemandResult
	if v1.DecodeTelemetry(e.Payload, &result, false) != nil {
		return fmt.Errorf("invalid telemetry demand result")
	}
	d := &t.demand
	// A superseded response is harmless. It cannot assert live mode for a later
	// revision/connection or refresh the grant's server-side deadline.
	if e.CorrelationID != d.pending || result.SessionGeneration != t.generation || result.DemandRevision != d.revision || result.LeaseID != d.lease {
		return nil
	}
	if result.State == "applied" && ((!d.enabled && result.Mode != "http") || (d.enabled && result.Mode == "http")) {
		return fmt.Errorf("contradictory telemetry mode result")
	}
	d.pending = ""
	if result.State == "rejected" || !now.Before(d.sentAt.Add(90*time.Second)) {
		d.mode = "degraded"
	} else {
		d.mode = result.Mode
	}
	return nil
}

// TelemetryDemand reports server-owned viewer references, independent of node
// connectivity and Agent acknowledgment. References alone never mean realtime.
func (g *Gateway) TelemetryDemand(node string) monitoring.DemandState { return g.demands.State(node) }

// demandError gates only WSS metrics. HTTP admission remains independent of
// browser demand and survives management disconnect until session expiry.
func (t *telemetrySession) demandError(now time.Time) string {
	if !t.demand.enabled || t.demand.revision == 0 {
		return "stale_demand"
	}
	if !now.Before(t.demand.sentAt.Add(90 * time.Second)) {
		return "lease_expired"
	}
	return ""
}
