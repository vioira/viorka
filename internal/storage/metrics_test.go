package storage

import "testing"

func metricNode(t testing.TB, s *Store, id string) {
	t.Helper()
	if _, err := s.db.Exec(`INSERT INTO nodes(id,name,kind,created_at) VALUES(?,?,'vps',?)`, id, id, now()); err != nil {
		t.Fatal(err)
	}
}
