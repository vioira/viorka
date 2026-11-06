package storage

import (
	"context"
	v1 "github.com/vioira/viorka/protocol/v1"
	"testing"
	"time"
)

func TestOfflineWindowAndRecovery(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	if err := s.InitSettings(ctx, "https://example.com"); err != nil {
		t.Fatal(err)
	}
	last := time.Now().UTC()
	if _, err := s.db.Exec(`INSERT INTO nodes(id,name,kind,state,created_at,last_seen_at) VALUES('node','node','vps','online',?,?)`, at(last), at(last)); err != nil {
		t.Fatal(err)
	}
	check := func(state string, count int) {
		t.Helper()
		n, err := s.Node(ctx, "node")
		if err != nil || n.State != state {
			t.Fatalf("node: %+v %v", n, err)
		}
		items, err := s.Notifications(ctx, "admin")
		if err != nil || len(items) != count {
			t.Fatalf("notifications: %d %v", len(items), err)
		}
	}
	expire := func(age time.Duration) {
		t.Helper()
		if err := s.ExpireOffline(ctx, last.Add(age)); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.Recover(ctx); err != nil {
		t.Fatal(err)
	}
	check("online", 0)
	expire(300 * time.Second)
	check("online", 0)
	if _, err := s.db.Exec(`UPDATE system_settings SET heartbeat_timeout_seconds=600`); err != nil {
		t.Fatal(err)
	}
	expire(301 * time.Second)
	check("online", 0)
	if _, err := s.db.Exec(`UPDATE system_settings SET heartbeat_timeout_seconds=60`); err != nil {
		t.Fatal(err)
	}
	expire(61 * time.Second)
	check("offline", 1)
	expire(62 * time.Second)
	check("offline", 1)
	if err := s.Online(ctx, "node", v1.Hello{}); err != nil {
		t.Fatal(err)
	}
	if err := s.Heartbeat(ctx, "node"); err != nil {
		t.Fatal(err)
	}
	if err := s.ExpireOffline(ctx, time.Now()); err != nil {
		t.Fatal(err)
	}
	check("online", 1)
	if _, err := s.db.Exec(`UPDATE system_settings SET alerts=0`); err != nil {
		t.Fatal(err)
	}
	expire(time.Hour)
	check("offline", 1)
}
