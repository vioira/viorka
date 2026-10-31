package storage

import (
	"context"
	"github.com/vioira/viorka/internal/auth"
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
	s.Close()
	s, err = Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.NodeSettings(ctx, "n")
	if err != nil || got != v {
		t.Fatalf("%+v %v", got, err)
	}
	var count int
	if err = s.db.QueryRow(`SELECT count(*) FROM audit_logs WHERE action='node.settings.update' AND resource_id='n'`).Scan(&count); err != nil || count != 1 {
		t.Fatal("missing audit", err, count)
	}
}
