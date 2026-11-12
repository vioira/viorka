package storage

import (
	"context"
	"errors"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/settings"
	v1 "github.com/vioira/viorka/protocol/v1"
	"slices"
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

func TestTCPProbeGlobalInheritanceAndOverride(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	if err := s.InitSettings(ctx, "https://panel.test"); err != nil {
		t.Fatal(err)
	}
	agents := auth.NewAgents(s, "https://panel.test")
	first, err := agents.CreateEnrollment(ctx, "admin", "first", "vps")
	if err != nil {
		t.Fatal(err)
	}
	second, err := agents.CreateEnrollment(ctx, "admin", "second", "vps")
	if err != nil {
		t.Fatal(err)
	}
	local, _ := s.TelemetrySettings(ctx, second.ID)
	local.TcpProbe = &v1.TelemetryTCPProbeSettings{Targets: []string{"1.1.1.1:443"}, Names: []string{"节点出口"}}
	local, err = s.SaveTelemetrySettings(ctx, "admin", second.ID, local)
	if err != nil {
		t.Fatal(err)
	}
	before, _ := s.TelemetrySettings(ctx, first.ID)
	before.LogLevel = "debug"
	before, err = s.SaveTelemetrySettings(ctx, "admin", first.ID, before)
	if err != nil {
		t.Fatal(err)
	}
	service := settings.New(s)
	global, err := service.Get(ctx)
	if err != nil {
		t.Fatal(err)
	}
	global.TCPProbeTargets = []string{"example.com:443"}
	global.TCPProbeNames = []string{"全局出口"}
	global, err = service.Save(ctx, "admin", global)
	if err != nil {
		t.Fatal(err)
	}
	inherited, _ := s.TelemetrySettings(ctx, first.ID)
	if inherited.Revision != before.Revision+1 || inherited.LogLevel != "debug" || inherited.TcpProbe == nil || !inherited.TcpProbe.UseGlobal || !slices.Equal(inherited.TcpProbe.Targets, global.TCPProbeTargets) || !slices.Equal(inherited.TcpProbe.Names, global.TCPProbeNames) {
		t.Fatalf("inherit: %+v", inherited)
	}
	independent, _ := s.TelemetrySettings(ctx, second.ID)
	if independent.Revision != local.Revision || !slices.Equal(independent.TcpProbe.Targets, local.TcpProbe.Targets) || !slices.Equal(independent.TcpProbe.Names, local.TcpProbe.Names) {
		t.Fatal("overrode independent node")
	}
	if _, err = s.SaveTelemetrySettings(ctx, "admin", first.ID, before); !errors.Is(err, auth.ErrConflict) {
		t.Fatal("stale node save accepted", err)
	}
	third, err := agents.CreateEnrollment(ctx, "admin", "third", "vps")
	if err != nil {
		t.Fatal(err)
	}
	fresh, _ := s.TelemetrySettings(ctx, third.ID)
	if fresh.TcpProbe == nil || !fresh.TcpProbe.UseGlobal {
		t.Fatal("new node did not inherit")
	}
	independent.TcpProbe = &v1.TelemetryTCPProbeSettings{Targets: []string{}}
	independent, err = s.SaveTelemetrySettings(ctx, "admin", second.ID, independent)
	if err != nil {
		t.Fatal(err)
	}
	global.TCPProbeTargets = []string{"example.net:443"}
	global, err = service.Save(ctx, "admin", global)
	if err != nil {
		t.Fatal(err)
	}
	disabled, _ := s.TelemetrySettings(ctx, second.ID)
	if disabled.TcpProbe == nil || disabled.TcpProbe.UseGlobal || len(disabled.TcpProbe.Targets) != 0 || disabled.Revision != independent.Revision {
		t.Fatal("empty override lost")
	}
	disabled.TcpProbe = &v1.TelemetryTCPProbeSettings{Targets: []string{}, UseGlobal: true}
	restored, err := s.SaveTelemetrySettings(ctx, "admin", second.ID, disabled)
	if err != nil || !restored.TcpProbe.UseGlobal || !slices.Equal(restored.TcpProbe.Targets, global.TCPProbeTargets) {
		t.Fatal("restore latest global", restored, err)
	}
	oldRevision := restored.Revision
	global.PanelName = "Other"
	global, err = service.Save(ctx, "admin", global)
	if err != nil {
		t.Fatal(err)
	}
	restored, _ = s.TelemetrySettings(ctx, second.ID)
	if restored.Revision != oldRevision {
		t.Fatal("unrelated global edit changed node revision")
	}
	global.TCPProbeTargets = []string{}
	global.TCPProbeNames = []string{}
	if _, err = service.Save(ctx, "admin", global); err != nil {
		t.Fatal(err)
	}
	inherited, _ = s.TelemetrySettings(ctx, first.ID)
	if inherited.TcpProbe != nil {
		t.Fatal("clearing global did not disable inherited targets")
	}
}
