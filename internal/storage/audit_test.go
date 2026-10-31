package storage

import (
	"context"
	"path/filepath"
	"testing"
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
