package storage

import (
	"context"
	"errors"
	"github.com/vioira/viorka/internal/auth"
	"testing"
	"time"
)

func TestAgentSessionClassification(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a := auth.NewAgents(s, "https://panel.test")
	e, err := a.CreateEnrollment(ctx, "admin", "session-test", "vps")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Enroll(ctx, auth.Hash(e.Token), "key"); err != nil {
		t.Fatal(err)
	}
	token := auth.Random()
	expiry := time.Now().UTC().Add(time.Hour)
	if _, err = s.db.Exec(`INSERT INTO agent_sessions VALUES(?,?,?)`, auth.Hash(token), e.ID, at(expiry)); err != nil {
		t.Fatal(err)
	}
	id, got, err := a.Authenticate(ctx, token)
	if err != nil || id != e.ID || !got.Equal(expiry) {
		t.Fatal(id, got, err)
	}
	check := func(want error) {
		t.Helper()
		id, got, err := a.Authenticate(ctx, token)
		if !errors.Is(err, want) || !errors.Is(err, auth.ErrUnauthorized) || id != "" || !got.IsZero() {
			t.Fatal(id, got, err)
		}
	}
	if _, err = s.db.Exec(`UPDATE agent_sessions SET expires_at=?`, at(time.Now().Add(-time.Hour))); err != nil {
		t.Fatal(err)
	}
	check(auth.ErrAgentSessionExpired)
	if _, err = s.db.Exec(`UPDATE nodes SET state='disabled' WHERE id=?`, e.ID); err != nil {
		t.Fatal(err)
	}
	check(auth.ErrAgentNodeDisabled)
	if _, err = s.db.Exec(`UPDATE agent_credentials SET status='revoked' WHERE node_id=?`, e.ID); err != nil {
		t.Fatal(err)
	}
	check(auth.ErrAgentIdentityRevoked)
	if _, err = s.db.Exec(`DELETE FROM agent_sessions`); err != nil {
		t.Fatal(err)
	}
	check(auth.ErrUnauthorized)
	if _, _, err = a.Authenticate(ctx, "invalid"); !errors.Is(err, auth.ErrUnauthorized) {
		t.Fatal(err)
	}
}

func TestOtherNodeChallengePreservesExpiredSessionClassification(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a := auth.NewAgents(s, "https://panel.test")
	var nodes [2]string
	for i := range nodes {
		e, err := a.CreateEnrollment(ctx, "admin", "session-test", "vps")
		if err != nil {
			t.Fatal(err)
		}
		if _, err = s.Enroll(ctx, auth.Hash(e.Token), e.ID); err != nil {
			t.Fatal(err)
		}
		nodes[i] = e.ID
	}
	token := auth.Random()
	if _, err := s.db.Exec(`INSERT INTO agent_sessions VALUES(?,?,?)`, auth.Hash(token), nodes[0], at(time.Now().Add(-time.Hour))); err != nil {
		t.Fatal(err)
	}
	c := auth.Challenge{ID: auth.Random(), Message: "challenge", ExpiresAt: time.Now().Add(time.Minute)}
	if err := s.SaveChallenge(ctx, nodes[1], c); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ConsumeChallenge(ctx, c.ID, func(string, string) bool { return true }, auth.Hash(auth.Random()), time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := a.Authenticate(ctx, token); !errors.Is(err, auth.ErrAgentSessionExpired) {
		t.Fatal(err)
	}
}
