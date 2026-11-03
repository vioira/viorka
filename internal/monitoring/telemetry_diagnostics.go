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
	status := "ok"
	if d.lastAccept.IsZero() {
		status = "waiting_for_data"
	}
	if level == slog.LevelWarn {
		status = "degraded"
	}
	attrs := []slog.Attr{
		slog.String("status", status), slog.Int("nodes", len(r.nodes)), slog.Int("dirty_nodes", dirty),
	}
	appendTime := func(key string, value time.Time) {
		if !value.IsZero() {
			attrs = append(attrs, slog.Time(key, value))
		}
	}
	appendTime("last_new_observation_accepted", d.lastAccept)
	appendTime("last_flush_success", d.flushSuccess)
	if r.bytes > 0 {
		attrs = append(attrs, slog.Int("accounted_bytes", r.bytes))
	}
	if level == slog.LevelWarn {
		appendTime("initialized_at", d.initialized)
		appendTime("last_flush_attempt", d.flushAttempt)
		appendTime("last_rotation_attempt", d.rotationAttempt)
		appendTime("last_rotation_success", d.rotationSuccess)
	}
	if r.failures > 0 {
		attrs = append(attrs, slog.Int("flush_failures", r.failures))
	}
	appendTime("flush_retry_at", r.retryAt)
	if d.cycleError {
		attrs = append(attrs, slog.Bool("maintenance_cycle_error", true))
	}
	if d.rotationError {
		attrs = append(attrs, slog.Bool("rotation_error", true))
	}
	if r.expiredDirty > 0 {
		attrs = append(attrs, slog.Uint64("expired_unpersisted_buckets", r.expiredDirty))
	}
	r.mu.Unlock()
	// Never hold the admission mutex across a potentially slow log sink.
	logger.LogAttrs(ctx, level, "Telemetry history status", attrs...)
}
