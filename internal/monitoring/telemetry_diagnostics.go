package monitoring

import (
	"context"
	"log/slog"
	"time"
)

// Protected by recorder.mu; aggregate state only, with no node payloads or
// arbitrary database errors. Successful receipt and durable commit are distinct.
type telemetryRecorderDiagnostics struct {
	cycleError                                          bool
	initialized, lastAccept, flushAttempt, flushSuccess time.Time
	rotationAttempt, rotationSuccess, nextLog           time.Time
	rotationError                                       bool
	reportedExpired                                     uint64
}

func (r *TelemetryRecorder) recordDiagnostics(ctx context.Context, logger *slog.Logger, now time.Time) {
	r.mu.Lock()
	d := &r.diagnostics
	if !d.nextLog.IsZero() && now.Before(d.nextLog) {
		r.mu.Unlock()
		return
	}
	d.nextLog = now.Add(time.Minute)
	dirty := 0
	for _, node := range r.nodes {
		if node.dirty {
			dirty++
		}
	}
	level := slog.LevelInfo
	if r.failures > 0 || d.cycleError || d.rotationError || r.expiredDirty > d.reportedExpired {
		level = slog.LevelWarn
	}
	d.reportedExpired = r.expiredDirty
	attrs := []slog.Attr{
		slog.Time("initialized_at", d.initialized), slog.Time("last_new_observation_accepted", d.lastAccept),
		slog.Time("last_flush_attempt", d.flushAttempt), slog.Time("last_flush_success", d.flushSuccess),
		slog.Bool("maintenance_cycle_error", d.cycleError), slog.Int("flush_failures", r.failures), slog.Time("flush_retry_at", r.retryAt),
		slog.Time("last_rotation_attempt", d.rotationAttempt), slog.Time("last_rotation_success", d.rotationSuccess),
		slog.Bool("rotation_error", d.rotationError), slog.Int("nodes", len(r.nodes)),
		slog.Int("dirty_nodes", dirty), slog.Int("accounted_bytes", r.bytes),
		slog.Uint64("expired_unpersisted_buckets", r.expiredDirty),
	}
	r.mu.Unlock()
	// Never hold the admission mutex across a potentially slow log sink.
	logger.LogAttrs(ctx, level, "Telemetry history status", attrs...)
}
