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
	expire(60 * time.Second)
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
	check("offline", 0)
	expire(360 * time.Second)
	check("offline", 0)
	expire(361 * time.Second)
	check("offline", 1)
	expire(362 * time.Second)
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
	if _, err := s.db.Exec(`UPDATE system_settings SET offline_alert_minutes=0`); err != nil {
		t.Fatal(err)
	}
	expire(time.Hour)
	check("offline", 1)
}

func TestOfflineAlertPolicyChanges(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	if err := s.InitSettings(ctx, "https://example.com"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec("INSERT INTO nodes(id,name,kind,state,created_at) VALUES('node','node','vps','online',?)", now()); err != nil {
		t.Fatal(err)
	}
	current := time.Now()
	tick := func(after time.Duration, want int) {
		t.Helper()
		if err := s.ExpireOffline(ctx, current.Add(after)); err != nil {
			t.Fatal(err)
		}
		items, err := s.Notifications(ctx, "admin")
		if err != nil || len(items) != want {
			t.Fatalf("after %v: got %d notifications, want %d: %v", after, len(items), want, err)
		}
	}
	setDelay := func(minutes int) {
		t.Helper()
		cfg, err := s.Settings(ctx)
		if err != nil {
			t.Fatal(err)
		}
		cfg.OfflineAlertMinutes = minutes
		if err := s.SaveSettings(ctx, "admin", cfg); err != nil {
			t.Fatal(err)
		}
	}
	reconnect := func() {
		t.Helper()
		if err := s.Online(ctx, "node", v1.Hello{}); err != nil {
			t.Fatal(err)
		}
	}
	tick(0, 0)
	reconnect()
	tick(5*time.Minute, 0) // New outage starts now; the old timer was cancelled.
	setDelay(10)
	tick(10*time.Minute, 0)
	setDelay(6)
	tick(11*time.Minute, 1)
	tick(12*time.Minute, 1)
	reconnect()
	tick(13*time.Minute, 1)
	setDelay(0)
	setDelay(5)
	tick(20*time.Minute, 1) // Disabling cancelled the pending notification.
	reconnect()
	tick(21*time.Minute, 1) // A late graceful close cancels the pending outage.
	if err := s.AgentStopped(ctx, "node"); err != nil {
		t.Fatal(err)
	}
	tick(time.Hour, 1)
}
