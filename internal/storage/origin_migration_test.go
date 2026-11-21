package storage

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"github.com/vioira/viorka/internal/auth"
	v1 "github.com/vioira/viorka/protocol/v1"
	"testing"
)

// Receiving an address or presenting a token from an earlier origin cannot
// confirm migration, even if the node reports the current target in its frame.
func TestOriginConfirmationRequiresCurrentSessionAndTarget(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	const oldOrigin = "https://old.example.com"
	const newOrigin = "https://new.example.com"
	if err := s.InitSettings(ctx, oldOrigin); err != nil {
		t.Fatal(err)
	}
	agents := auth.NewAgents(s)
	e, err := agents.CreateEnrollment(ctx, "admin", "origin-test", "nat")
	if err != nil {
		t.Fatal(err)
	}
	public, key, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	node, err := agents.Enroll(ctx, e.Token, base64.StdEncoding.EncodeToString(public), v1.Version)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Online(ctx, node, v1.Hello{Capabilities: []string{v1.OriginMigrationCapability}}); err != nil {
		t.Fatal(err)
	}
	session := func(origin string) string {
		t.Helper()
		challenge, err := agents.Challenge(ctx, node, origin)
		if err != nil {
			t.Fatal(err)
		}
		credential, err := agents.Session(ctx, challenge.ID, base64.StdEncoding.EncodeToString(ed25519.Sign(key, []byte(challenge.Message))))
		if err != nil {
			t.Fatal(err)
		}
		return credential.Token
	}
	oldToken := session(oldOrigin)
	cfg, err := s.Settings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	cfg.PublicOrigin = newOrigin
	if err = s.SaveSettings(ctx, "admin", cfg); err != nil {
		t.Fatal(err)
	}
	if needed, err := s.OriginRefreshNeeded(ctx, node, auth.Hash(oldToken)); err != nil || !needed {
		t.Fatal("missing migration notice", err)
	}
	check := func(token, reported, want string) {
		t.Helper()
		if err := s.ConfirmOrigin(ctx, node, auth.Hash(token), reported); err != nil {
			t.Fatal(err)
		}
		n, err := s.Node(ctx, node)
		if err != nil || n.OriginMigration != want {
			t.Fatalf("migration=%q want %q: %v", n.OriginMigration, want, err)
		}
	}
	check(oldToken, newOrigin, "pending")
	newToken := session(newOrigin)
	check(oldToken, newOrigin, "pending")
	check(newToken, oldOrigin, "pending")
	check(newToken, newOrigin, "confirmed")
}
