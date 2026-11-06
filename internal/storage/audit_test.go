package storage

import (
	"context"
	"path/filepath"
	"testing"

	auditlog "github.com/vioira/viorka/internal/audit"
)

func TestAuditStablePaginationAndProjection(t *testing.T) {
	ctx := context.Background()
	s, err := Open(ctx, filepath.Join(t.TempDir(), "db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for _, id := range []string{"a", "b", "c"} {
		_, err = s.db.Exec(`INSERT INTO audit_logs(id,action,resource_type,summary_json,created_at) VALUES(?,'test','node','{"secret":"never exposed"}','2026-10-31T00:00:00Z')`, id)
		if err != nil {
			t.Fatal(err)
		}
	}
	first, err := s.AuditLogs(ctx, 2, "", "system")
	if err != nil || len(first) != 2 || first[0].ID != "c" || first[1].ID != "b" {
		t.Fatalf("%+v %v", first, err)
	}
	// New records must not shift the next page.
	_, err = s.db.Exec(`INSERT INTO audit_logs(id,action,resource_type,created_at) VALUES('d','test','node','2026-10-31T00:00:01Z')`)
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.AuditLogs(ctx, 2, "b", "all")
	if err != nil || len(second) != 1 || second[0].ID != "a" || second[0].ActorID != "" || second[0].SourceIP != "" {
		t.Fatalf("%+v %v", second, err)
	}
	s.Close()
	if _, err = s.AuditLogs(ctx, 2, "", "all"); err == nil {
		t.Fatal("storage failure hidden")
	}
}

func TestAuditSystemSourceIP(t *testing.T) {
	ctx := context.Background()
	s, err := Open(ctx, filepath.Join(t.TempDir(), "db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for _, tc := range []struct{ id, source string }{
		{"manual", "203.0.113.8"},
		{"automatic", ""},
	} {
		requestCtx := ctx
		if tc.source != "" {
			requestCtx = auditlog.WithSourceIP(ctx, tc.source)
		}
		if err := s.AuditSystem(requestCtx, "", "backup.create", tc.id); err != nil {
			t.Fatal(err)
		}
	}
	rows, err := s.AuditLogs(ctx, 10, "", "system")
	if err != nil || len(rows) != 2 {
		t.Fatalf("rows=%+v err=%v", rows, err)
	}
	for _, row := range rows {
		want := ""
		if row.ResourceID == "manual" {
			want = "203.0.113.8"
		}
		if row.SourceIP != want {
			t.Fatalf("%s source=%q want=%q", row.ResourceID, row.SourceIP, want)
		}
	}
}
