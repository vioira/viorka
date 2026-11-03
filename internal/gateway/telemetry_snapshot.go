package gateway

import (
	"time"

	"github.com/vioira/viorka/internal/monitoring"
	"github.com/vioira/viorka/internal/realtime"
)

type telemetryStatus struct {
	mode    string
	expires time.Time
}

func (g *Gateway) publishTelemetryStatus(node string, t *telemetrySession) {
	if !t.applied {
		return
	}
	status := telemetryStatus{mode: t.demand.mode}
	if status.mode == "" {
		status.mode = "http"
	}
	if t.demand.enabled {
		status.expires = t.demand.sentAt.Add(90 * time.Second)
	}
	g.mu.Lock()
	old, exists := g.telemetryStatus[node]
	g.telemetryStatus[node] = status
	g.mu.Unlock()
	if (!exists || old != status) && g.events != nil {
		g.events.Publish(realtime.Change{Kind: "metrics", NodeID: node})
	}
}

// ReadMetrics projects telemetry v3. Cache failures propagate to REST/SSE.
func (g *Gateway) ReadMetrics(node string, cursor monitoring.Cursor, summary bool) (monitoring.LiveSnapshot, error) {
	now := time.Now()
	out := monitoring.LiveSnapshot{Snapshot: monitoring.Snapshot{Stale: true, History: []monitoring.Point{}}, Reset: true, Points: []monitoring.LivePoint{}}
	if g.telemetry == nil {
		return out, nil
	}
	g.mu.Lock()
	status, negotiated := g.telemetryStatus[node]
	g.mu.Unlock()
	mode := status.mode
	if mode == "" {
		mode = "http"
	}
	// Preserve the deployed v3 cursor namespace across this retirement.
	const telemetryGenerationBit = uint64(1) << 63
	liveCursor := cursor
	if liveCursor.Generation&telemetryGenerationBit == 0 {
		liveCursor = monitoring.Cursor{}
	} else {
		liveCursor.Generation &^= telemetryGenerationBit
	}
	live, err := g.telemetry.Live(node, now, liveCursor, mode == "realtime", summary)
	if err != nil {
		return monitoring.LiveSnapshot{}, err
	}
	if live.RunID == "" && !negotiated && live.Settings == nil {
		return out, nil
	}
	scope := g.demands.State(node)
	control := &monitoring.TelemetryControlStatus{Mode: mode, References: scope.References}
	if status.expires.After(now) {
		control.LeaseRemainingSeconds = uint64(status.expires.Sub(now).Seconds())
	}
	out = monitoring.LiveSnapshot{
		Snapshot: monitoring.Snapshot{Telemetry: &live, TelemetryControl: control, ReceivedAt: live.MetricsReceivedAt, Stale: live.FastStale, History: []monitoring.Point{}},
		Sequence: live.Sequence, Generation: live.Generation | telemetryGenerationBit, Reset: live.Reset, Points: []monitoring.LivePoint{},
	}
	return out, nil
}
