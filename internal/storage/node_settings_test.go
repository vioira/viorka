package storage

import (
	"context"
	"github.com/vioira/viorka/internal/auth"
	v1 "github.com/vioira/viorka/protocol/v1"
	"path/filepath"
	"testing"
)

func TestNodeSettingsPersistAcrossReopen(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "db")
	s, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { s.Close() }()
	if err = s.Bootstrap(ctx, auth.User{ID: "a", Username: "a", PasswordHash: "x", Role: "admin"}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(`INSERT INTO nodes(id,name,kind,created_at) VALUES('n','test','nat',?)`, now()); err != nil {
		t.Fatal(err)
	}
	v, err := s.NodeSettings(ctx, "n")
	if err != nil {
		t.Fatal(err)
	}
	v.CollectionSeconds = 10
	v.ReportSeconds = 180
	v.WssReportSeconds = 1
	v, err = s.SaveNodeSettings(ctx, "a", "n", v)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(`UPDATE nodes SET connection_mode='http_post' WHERE id='n'`); err == nil {
		t.Fatal("database accepted unsupported mode")
	}
	result := v1.NodeSettingsResult{Revision: v.Revision, AppliedRevision: v.Revision, State: "applied"}
	if err = s.RecordSettingsResult(ctx, "n", result); err != nil {
		t.Fatal(err)
	}
	s.Close()
	s, err = Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.NodeSettings(ctx, "n")
	if err != nil || got != v {
		t.Fatalf("%+v %v", got, err)
	}
	restored, err := s.SettingsResult(ctx, "n")
	if err != nil || restored == nil || *restored != result {
		t.Fatal("receipt not durable", restored, err)
	}
	failed := result
	failed.State = "failed"
	failed.ErrorCode = "persist_failed"
	if err = s.RecordSettingsResult(ctx, "n", failed); err != nil {
		t.Fatal(err)
	}
	restored, _ = s.SettingsResult(ctx, "n")
	if restored.State != "applied" {
		t.Fatal("late failure regressed success")
	}
	var count int
	if err = s.db.QueryRow(`SELECT count(*) FROM audit_logs WHERE action='node.settings.update' AND resource_id='n'`).Scan(&count); err != nil || count != 1 {
		t.Fatal("missing audit", err, count)
	}
	newer, err := s.SaveNodeSettings(ctx, "a", "n", v)
	if err != nil {
		t.Fatal(err)
	}
	if newer.Revision != v.Revision+1 {
		t.Fatal("revision")
	}
	if err = s.RecordSettingsResult(ctx, "n", result); err != nil {
		t.Fatal(err)
	}
	if status, err := s.SettingsResult(ctx, "n"); err != nil || status != nil {
		t.Fatal("old receipt marked new desired applied", status, err)
	}
}
