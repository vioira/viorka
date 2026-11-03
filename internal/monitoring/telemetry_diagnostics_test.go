package monitoring

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"
)

func TestTelemetryHistoryDiagnosticsFailureRecoveryAndBounds(t *testing.T) {
	ctx := context.Background()
	at := time.Date(2026, 11, 3, 0, 0, 0, 0, time.UTC)
	repo := &telemetryCommitHookRepo{}
	r, err := NewTelemetryRecorder(ctx, repo, at)
	if err != nil {
		t.Fatal(err)
	}
	if err := recordTestObservation(r, "secret-node", at); err != nil {
		t.Fatal(err)
	}
	repo.hook = func() error { return errors.New("secret database path or query") }
	if err := r.Flush(ctx, at, false); err == nil {
		t.Fatal("write failure hidden")
	}
	var output bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&output, nil))
	r.recordDiagnostics(ctx, logger, at)
	if err := r.Flush(ctx, at.Add(time.Second), false); err != nil {
		t.Fatal(err)
	}
	if len(repo.commits) != 0 {
		t.Fatal("backoff bypassed")
	}
	for i := 1; i < 60; i++ {
		r.recordDiagnostics(ctx, logger, at.Add(time.Duration(i)*time.Second))
	}
	lines := strings.Split(strings.TrimSpace(output.String()), "\n")
	if len(lines) != 1 {
		t.Fatal("status not limited", len(lines))
	}
	if strings.Contains(output.String(), "secret") {
		t.Fatal("raw database/node data logged")
	}
	var got map[string]any
	if err := json.Unmarshal([]byte(lines[0]), &got); err != nil {
		t.Fatal(err)
	}
	if got["level"] != "WARN" || got["flush_failures"] != float64(1) || got["dirty_nodes"] != float64(1) || got["last_new_observation_accepted"] != at.Format(time.RFC3339) || got["last_flush_attempt"] != at.Format(time.RFC3339) || got["last_flush_success"] != nil || got["status"] != "degraded" {
		t.Fatal(got)
	}
	if err := r.Flush(ctx, at.Add(time.Minute), false); err != nil {
		t.Fatal(err)
	}
	r.recordDiagnostics(ctx, logger, at.Add(time.Minute))
	lines = strings.Split(strings.TrimSpace(output.String()), "\n")
	if len(lines) != 2 {
		t.Fatal("recovery status missing")
	}
	got = nil
	if err := json.Unmarshal([]byte(lines[1]), &got); err != nil {
		t.Fatal(err)
	}
	if got["level"] != "INFO" || got["flush_failures"] != nil || got["status"] != "ok" || got["dirty_nodes"] != float64(0) || got["last_flush_success"] != at.Add(time.Minute).Format(time.RFC3339) {
		t.Fatal(got)
	}
	// Many expired buckets still produce one aggregate warning, and the lifetime
	// counter remains visible after the warning has been emitted.
	r.mu.Lock()
	r.expiredDirty = 1000
	r.mu.Unlock()
	r.recordDiagnostics(ctx, logger, at.Add(2*time.Minute))
	lines = strings.Split(strings.TrimSpace(output.String()), "\n")
	if len(lines) != 3 {
		t.Fatal("expiry flood")
	}
	got = nil
	if err := json.Unmarshal([]byte(lines[2]), &got); err != nil {
		t.Fatal(err)
	}
	if got["level"] != "WARN" || got["expired_unpersisted_buckets"] != float64(1000) {
		t.Fatal(got)
	}
	output.Reset()
	r.recordDiagnostics(ctx, logger, at.Add(3*time.Minute))
	got = nil
	if err := json.Unmarshal(output.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got["level"] != "INFO" || got["expired_unpersisted_buckets"] != float64(1000) {
		t.Fatal("cumulative loss hidden after warning", got)
	}
}

type telemetryRotationDiagnosticRepo struct {
	telemetryMemoryRepo
	rotationErr error
}

func (r *telemetryRotationDiagnosticRepo) RotateTelemetryHistory(context.Context, time.Time) error {
	return r.rotationErr
}

func TestTelemetryHistoryInitializationDiagnostics(t *testing.T) {
	at := time.Date(2026, 11, 3, 0, 0, 0, 0, time.UTC)
	ctx := context.Background()
	repo := &telemetryRotationDiagnosticRepo{rotationErr: errors.New("initialization failed")}
	if r, err := NewTelemetryRecorder(ctx, repo, at); err == nil || r != nil {
		t.Fatal("failed initialization reported success")
	}
	repo.rotationErr = ErrPartitionClockRollback
	r, err := NewTelemetryRecorder(ctx, repo, at)
	if err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	r.recordDiagnostics(ctx, slog.New(slog.NewJSONHandler(&output, nil)), at)
	var got map[string]any
	if err := json.Unmarshal(output.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got["rotation_error"] != true || got["level"] != "WARN" || got["last_rotation_success"] != nil || got["status"] != "degraded" || got["initialized_at"] != at.Format(time.RFC3339) {
		t.Fatal("rollback warning lost", got)
	}
	repo.rotationErr = nil
	r, err = NewTelemetryRecorder(ctx, repo, at)
	if err != nil {
		t.Fatal(err)
	}
	output.Reset()
	got = nil
	r.recordDiagnostics(ctx, slog.New(slog.NewJSONHandler(&output, nil)), at)
	if err := json.Unmarshal(output.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got["level"] != "INFO" || got["status"] != "waiting_for_data" || got["nodes"] != float64(0) || got["dirty_nodes"] != float64(0) || len(got) != 6 {
		t.Fatal("idle status should only contain the summary and standard log fields", got)
	}
	output.Reset()
	r.recordDiagnostics(ctx, slog.New(slog.NewTextHandler(&output, nil)), at.Add(time.Minute))
	if !strings.Contains(output.String(), "status=waiting_for_data nodes=0 dirty_nodes=0") || strings.Contains(output.String(), "0001-") {
		t.Fatal("idle text log is not compact", output.String())
	}
}
