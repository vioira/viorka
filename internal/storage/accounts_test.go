package storage

import (
	"context"
	"github.com/vioira/viorka/internal/auth"
	"sync"
	"testing"
	"time"
)

func TestPasswordCASInvalidatesSessionsAndRejectsStaleLogin(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	u := auth.User{ID: "admin", PasswordHash: "not-used"}
	v := auth.Session{User: u, CSRF: "csrf", ExpiresAt: time.Now().Add(time.Hour)}
	if e := s.SaveSession(ctx, "current", v); e != nil {
		t.Fatal(e)
	}
	if _, e := s.db.Exec(`INSERT INTO web_sessions VALUES('other','admin','csrf',?)`, at(v.ExpiresAt)); e != nil {
		t.Fatal(e)
	}
	if e := s.ChangePassword(ctx, "admin", "not-used", "new-hash", "current"); e != nil {
		t.Fatal(e)
	}
	if _, e := s.Session(ctx, "current"); e != nil {
		t.Fatal(e)
	}
	if _, e := s.Session(ctx, "other"); e != auth.ErrUnauthorized {
		t.Fatal(e)
	}
	if e := s.ChangePassword(ctx, "admin", "not-used", "racing-hash", "current"); e != auth.ErrConflict {
		t.Fatal(e)
	}
	if e := s.SaveSession(ctx, "stale-login", v); e != auth.ErrUnauthorized {
		t.Fatal("old login resurrected", e)
	}
	if _, e := s.Session(ctx, "current"); e != nil {
		t.Fatal("failed login removed current session", e)
	}
}
func TestConcurrentLastAdminProtection(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	if _, e := s.db.Exec(`INSERT INTO users(id,username,password_hash,role,created_at) VALUES('second','second','hash','admin',?)`, now()); e != nil {
		t.Fatal(e)
	}
	var wg sync.WaitGroup
	result := make(chan error, 2)
	for _, id := range []string{"admin", "second"} {
		wg.Add(1)
		go func() { defer wg.Done(); result <- s.ChangeRole(ctx, "admin", id, "viewer") }()
	}
	wg.Wait()
	close(result)
	successes := 0
	for e := range result {
		if e == nil {
			successes++
		} else if e != auth.ErrConflict {
			t.Fatal(e)
		}
	}
	if successes != 1 {
		t.Fatal(successes)
	}
}
func TestOfflineNotificationPreference(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	if e := s.InitSettings(ctx, "https://example.com"); e != nil {
		t.Fatal(e)
	}
	if _, e := s.db.Exec(`INSERT INTO nodes(id,name,kind,state,created_at) VALUES('node','node','vps','online',?)`, now()); e != nil {
		t.Fatal(e)
	}
	if e := s.Offline(ctx, "node"); e != nil {
		t.Fatal(e)
	}
	if e := s.Offline(ctx, "node"); e != nil {
		t.Fatal(e)
	}
	list, e := s.Notifications(ctx)
	if e != nil || len(list) != 1 {
		t.Fatal(list, e)
	}
	if _, e = s.db.Exec(`UPDATE system_settings SET alerts=0; UPDATE nodes SET state='online'`); e != nil {
		t.Fatal(e)
	}
	if e = s.Offline(ctx, "node"); e != nil {
		t.Fatal(e)
	}
	list, e = s.Notifications(ctx)
	if e != nil || len(list) != 1 {
		t.Fatal(list, e)
	}
}
