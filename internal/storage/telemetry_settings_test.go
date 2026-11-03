package storage

import (
	"context"
	"errors"
	"github.com/vioira/viorka/internal/auth"
	v1 "github.com/vioira/viorka/protocol/v1"
	"testing"
)

func TestTelemetrySettingsIndependentRevisionAndResults(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a := auth.NewAgents(s, "https://panel.test")
	e, err := a.CreateEnrollment(ctx, "admin", "settings", "vps")
	if err != nil {
		t.Fatal(err)
	}
	settings, err := s.TelemetrySettings(ctx, e.ID)
	if err != nil || settings != v1.DefaultTelemetrySettings() {
		t.Fatal(settings, err)
	}
	settings.LogLevel = "debug"
	settings.CollectionSeconds = 60
	settings.HttpReportSeconds = 30
	if _, err = s.SaveTelemetrySettings(ctx, "missing-user", e.ID, settings); err == nil {
		t.Fatal("audit failure ignored")
	}
	current, _ := s.TelemetrySettings(ctx, e.ID)
	if current != v1.DefaultTelemetrySettings() {
		t.Fatal("audit failure mutated settings")
	}
	saved, err := s.SaveTelemetrySettings(ctx, "admin", e.ID, settings)
	if err != nil || saved.Revision != 2 {
		t.Fatal(saved, err)
	}
	if _, err = s.SaveTelemetrySettings(ctx, "admin", e.ID, settings); !errors.Is(err, auth.ErrConflict) {
		t.Fatal(err)
	}
	if err = s.RecordTelemetrySettingsResult(ctx, e.ID, v1.TelemetrySettingsResult{Revision: 1, AppliedRevision: 1, State: "applied"}); err != nil {
		t.Fatal(err)
	}
	if result, err := s.TelemetrySettingsResult(ctx, e.ID); err != nil || result != nil {
		t.Fatal("stale result", result, err)
	}
	applied := v1.TelemetrySettingsResult{Revision: 2, AppliedRevision: 2, State: "applied"}
	if err = s.RecordTelemetrySettingsResult(ctx, e.ID, applied); err != nil {
		t.Fatal(err)
	}
	if err = s.RecordTelemetrySettingsResult(ctx, e.ID, v1.TelemetrySettingsResult{Revision: 2, State: "failed", ErrorCode: "persist_failed"}); err != nil {
		t.Fatal(err)
	}
	if result, err := s.TelemetrySettingsResult(ctx, e.ID); err != nil || result == nil || *result != applied {
		t.Fatal("terminal regression", result, err)
	}
	saved, err = s.SaveTelemetrySettings(ctx, "admin", e.ID, saved)
	if err != nil {
		t.Fatal(err)
	}
	if result, err := s.TelemetrySettingsResult(ctx, e.ID); err != nil || result != nil {
		t.Fatal("old result not cleared", result, err)
	}
	if _, err = s.db.Exec(`DELETE FROM nodes WHERE id=?`, e.ID); err != nil {
		t.Fatal(err)
	}
	if err = s.RecordTelemetrySettingsResult(ctx, e.ID, applied); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = s.db.QueryRow(`SELECT count(*) FROM node_telemetry_settings WHERE node_id=?`, e.ID).Scan(&count); err != nil || count != 0 {
		t.Fatal("deleted settings resurrected", count, err)
	}
}
