package storage

import (
	"context"
	"errors"
	"github.com/vioira/viorka/internal/auth"
	"sync"
	"testing"
	"time"
)

func TestSessionHistoryLifecycle(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	u := auth.User{ID: "admin", PasswordHash: "not-used"}
	v := auth.Session{User: u, CSRF: "csrf", ExpiresAt: time.Now().Add(time.Hour)}
	first := auth.WithLoginMetadata(ctx, auth.LoginMetadata{IP: "192.0.2.1", UserAgent: "test agent", Source: "https://panel.example", Method: "password"})
	if e := s.SaveSession(first, "first", v); e != nil {
		t.Fatal(e)
	}
	if e := s.SaveSession(ctx, "second", v); e != nil {
		t.Fatal(e)
	}
	if _, e := s.Session(ctx, "first"); e != nil {
		t.Fatal("concurrent session invalidated", e)
	}
	for _, ip := range []string{"192.0.2.2", "192.0.2.1"} {
		if e := s.TouchSession(ctx, "first", auth.LoginMetadata{IP: ip}); e != nil {
			t.Fatal(e)
		}
	}
	records, e := s.SessionHistory(ctx, "admin", "first", "", 10)
	if e != nil || len(records) != 2 {
		t.Fatal(records, e)
	}
	var current auth.SessionRecord
	for _, r := range records {
		if r.Current {
			current = r
		}
	}
	if current.UserAgent != "test agent" || current.FirstIP != "192.0.2.1" || current.LatestIP != "192.0.2.1" || len(current.IPs) != 2 || current.LastActiveAt < current.CreatedAt {
		t.Fatalf("bad history: %+v", current)
	}
	if e = s.RevokeSession(ctx, "another", current.ID); !errors.Is(e, auth.ErrNotFound) {
		t.Fatal("cross-user revoke", e)
	}
	if e = s.DeleteSession(ctx, "first"); e != nil {
		t.Fatal(e)
	}
	records, e = s.SessionHistory(ctx, "admin", "", "", 10)
	if e != nil {
		t.Fatal(e)
	}
	for _, r := range records {
		if r.ID == current.ID && (r.EndReason != "logout" || r.EndedAt == "") {
			t.Fatal(r)
		}
	}
	page, e := s.SessionHistory(ctx, "admin", "", "", 1)
	if e != nil || len(page) != 1 {
		t.Fatal(e)
	}
	next, e := s.SessionHistory(ctx, "admin", "", page[0].ID, 1)
	if e != nil || len(next) != 1 || next[0].ID == page[0].ID {
		t.Fatal(next, e)
	}
	if e = s.LogoutAll(ctx, "admin"); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Session(ctx, "second"); !errors.Is(e, auth.ErrUnauthorized) {
		t.Fatal(e)
	}
	v.ExpiresAt = time.Now().Add(-time.Hour)
	if e = s.SaveSession(ctx, "expired", v); e != nil {
		t.Fatal(e)
	}
	records, e = s.SessionHistory(ctx, "admin", "", "", 10)
	if e != nil {
		t.Fatal(e)
	}
	for _, r := range records {
		if r.ExpiresAt == at(v.ExpiresAt) && (r.EndReason != "expired" || r.EndedAt != r.ExpiresAt) {
			t.Fatal(r)
		}
	}
}
func TestCeremonyConsumptionBoundaries(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	c := auth.Ceremony{UserID: "admin", Kind: "register", Binding: "session", Data: "{}"}
	if e := s.SaveCeremony(ctx, "challenge", c, time.Now().Add(time.Minute)); e != nil {
		t.Fatal(e)
	}
	for _, tc := range [][2]string{{"login", "session"}, {"register", "other"}} {
		if _, e := s.TakeCeremony(ctx, "challenge", tc[0], tc[1]); !errors.Is(e, auth.ErrUnauthorized) {
			t.Fatal(e)
		}
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for range 2 {
		wg.Go(func() { _, e := s.TakeCeremony(ctx, "challenge", "register", "session"); results <- e })
	}
	wg.Wait()
	close(results)
	success := 0
	for e := range results {
		if e == nil {
			success++
		} else if !errors.Is(e, auth.ErrUnauthorized) {
			t.Fatal(e)
		}
	}
	if success != 1 {
		t.Fatal("replay", success)
	}
	if e := s.SaveCeremony(ctx, "expired", c, time.Now().Add(-time.Minute)); e != nil {
		t.Fatal(e)
	}
	if _, e := s.TakeCeremony(ctx, "expired", "register", "session"); !errors.Is(e, auth.ErrUnauthorized) {
		t.Fatal(e)
	}
}
