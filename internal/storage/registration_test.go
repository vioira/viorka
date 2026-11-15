package storage

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/inventory"
)

func registrationKey(t *testing.T) string {
	t.Helper()
	key, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(key)
}
func batchToken(t *testing.T, a *auth.Agents, max int) auth.RegistrationSecret {
	t.Helper()
	v, err := a.CreateRegistrationToken(context.Background(), "admin", auth.RegistrationOptions{Name: "batch", Kind: "nat", NamePrefix: "hk-", ExpiresInHours: 24, MaxUses: max})
	if err != nil {
		t.Fatal(err)
	}
	return v
}
func TestBatchRegistrationAtomicQuotaAndIdentity(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a := auth.NewAgents(s, "https://panel.test")
	token := batchToken(t, a, 3)
	keys := make([]string, 12)
	for i := range keys {
		keys[i] = registrationKey(t)
	}
	var wg sync.WaitGroup
	ids := make([]string, len(keys))
	errs := make([]error, len(keys))
	for i := range keys {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ids[i], errs[i] = a.Register(ctx, auth.RegisterRequest{Token: token.Token, PublicKey: keys[i], ProtocolVersion: "1.0", Hostname: "server"})
		}()
	}
	wg.Wait()
	count := 0
	for i, id := range ids {
		if id == "" {
			if !errors.Is(errs[i], auth.ErrRegistrationLimit) {
				t.Fatal(errs[i])
			}
			continue
		}
		count++
		node, err := s.Node(ctx, id)
		if err != nil || node.Name != "hk-server" || node.State != "offline" || node.Kind != "nat" {
			t.Fatal(node, err)
		}
		retry, err := a.Register(ctx, auth.RegisterRequest{Token: token.Token, PublicKey: keys[i], ProtocolVersion: "1.0", Name: "changed"})
		if err != nil || retry != id {
			t.Fatal(retry, err)
		}
	}
	if count != 3 {
		t.Fatal(count)
	}
	items, err := a.RegistrationTokens(ctx, 50, "")
	if err != nil || len(items) != 1 || items[0].UsedCount != 3 {
		t.Fatal(items, err)
	}
	var stored string
	if err = s.db.QueryRow(`SELECT token_hash FROM node_registration_tokens WHERE id=?`, token.ID).Scan(&stored); err != nil || stored != auth.Hash(token.Token) {
		t.Fatal(stored, err)
	}
	records, err := a.RegistrationRecords(ctx, token.ID, 1, "")
	if err != nil || len(records) != 1 {
		t.Fatal(records, err)
	}
	next, err := a.RegistrationRecords(ctx, token.ID, 1, records[0].ID)
	if err != nil || len(next) != 1 || next[0].ID == records[0].ID {
		t.Fatal(next, err)
	}
	var audits int
	if err = s.db.QueryRow(`SELECT count(*) FROM audit_logs WHERE action='node.register' AND actor_id IS NULL`).Scan(&audits); err != nil || audits != 3 {
		t.Fatal(audits, err)
	}
}
func TestBatchRegistrationLifecycleAndRollback(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a := auth.NewAgents(s, "https://panel.test")
	token := batchToken(t, a, 10)
	request := auth.RegisterRequest{Token: token.Token, PublicKey: registrationKey(t), ProtocolVersion: "1.0", Name: "自定义名称"}
	if _, err := s.db.Exec(`CREATE TRIGGER fail_registration_audit BEFORE INSERT ON audit_logs WHEN NEW.action='node.register' BEGIN SELECT RAISE(ABORT,'audit failure'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Register(ctx, request); err == nil {
		t.Fatal("audit failure ignored")
	}
	for _, table := range []string{"nodes", "agent_credentials", "node_registrations"} {
		var count int
		if err := s.db.QueryRow(`SELECT count(*) FROM ` + table).Scan(&count); err != nil || count != 0 {
			t.Fatal(table, count, err)
		}
	}
	tokens, _ := a.RegistrationTokens(ctx, 10, "")
	if tokens[0].UsedCount != 0 {
		t.Fatal("quota leaked")
	}
	if _, err := s.db.Exec(`DROP TRIGGER fail_registration_audit`); err != nil {
		t.Fatal(err)
	}
	id, err := a.Register(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	node, _ := s.Node(ctx, id)
	if node.Name != request.Name {
		t.Fatal(node)
	}
	other := batchToken(t, a, 1)
	wrong := request
	wrong.Token = other.Token
	if _, err = a.Register(ctx, wrong); !errors.Is(err, auth.ErrConflict) {
		t.Fatal(err)
	}
	if err = s.RevokeNode(ctx, "admin", id); err != nil {
		t.Fatal(err)
	}
	if _, err = a.Register(ctx, request); !errors.Is(err, auth.ErrUnauthorized) {
		t.Fatal(err)
	}
	if err = s.DeleteNode(ctx, "admin", id); err != nil {
		t.Fatal(err)
	}
	if _, err = a.Register(ctx, request); !errors.Is(err, auth.ErrConflict) {
		t.Fatal(err)
	}
	records, err := a.RegistrationRecords(ctx, token.ID, 10, "")
	if err != nil || len(records) != 1 || records[0].State != "deleted" {
		t.Fatal(records, err)
	}
	if err = a.RevokeRegistrationToken(ctx, "admin", token.ID); err != nil {
		t.Fatal(err)
	}
	request.PublicKey = registrationKey(t)
	if _, err = a.Register(ctx, request); !errors.Is(err, auth.ErrUnauthorized) {
		t.Fatal(err)
	}
	request.Token = other.Token
	if _, err = s.db.Exec(`UPDATE node_registration_tokens SET expires_at='2000-01-01T00:00:00Z' WHERE id=?`, other.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = a.Register(ctx, request); !errors.Is(err, auth.ErrUnauthorized) {
		t.Fatal(err)
	}
}
func TestBatchRegistrationSnapshotAndDown(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a := auth.NewAgents(s, "https://panel.test")
	token := batchToken(t, a, 2)
	request := auth.RegisterRequest{Token: token.Token, PublicKey: registrationKey(t), ProtocolVersion: "1.0"}
	if _, err := a.Register(ctx, request); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "snapshot.db")
	if err := s.Backup(ctx, path); err != nil {
		t.Fatal(err)
	}
	if err := ValidateSnapshot(ctx, path); err != nil {
		t.Fatal(err)
	}
	if err := PrepareRestoredSnapshot(ctx, path); err != nil {
		t.Fatal(err)
	}
	restored, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	if _, err = auth.NewAgents(restored, "https://panel.test").Register(ctx, request); !errors.Is(err, auth.ErrUnauthorized) {
		t.Fatal(err)
	}
	down, err := os.ReadFile("../../migrations/0020_node_registration.down.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(string(down)); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = s.db.QueryRow(`SELECT count(*) FROM sqlite_master WHERE name IN ('node_registrations','node_registration_tokens')`).Scan(&count); err != nil || count != 0 {
		t.Fatal(count, err)
	}
}
func TestRenameNodeCASAuditAndIdentity(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a := auth.NewAgents(s, "https://panel.test")
	e, err := a.CreateEnrollment(ctx, "admin", "original", "vps")
	if err != nil {
		t.Fatal(err)
	}
	if err = inventory.Rename(ctx, s, "missing", e.ID, "new", "original"); err == nil {
		t.Fatal("missing audit actor accepted")
	}
	n, _ := s.Node(ctx, e.ID)
	if n.Name != "original" {
		t.Fatal("audit did not roll back")
	}
	if err = inventory.Rename(ctx, s, "admin", e.ID, "  renamed  ", "original"); err != nil {
		t.Fatal(err)
	}
	if err = inventory.Rename(ctx, s, "admin", e.ID, "renamed", "original"); err != nil {
		t.Fatal("lost response retry", err)
	}
	if err = inventory.Rename(ctx, s, "admin", e.ID, "other", "original"); !errors.Is(err, auth.ErrConflict) {
		t.Fatal(err)
	}
	if err = inventory.Rename(ctx, s, "admin", e.ID, "\n", "renamed"); !errors.Is(err, auth.ErrInvalid) {
		t.Fatal(err)
	}
	id, err := s.Enroll(ctx, auth.Hash(e.Token), registrationKey(t))
	if err != nil || id != e.ID {
		t.Fatal(id, err)
	}
	n, _ = s.Node(ctx, id)
	if n.Name != "renamed" {
		t.Fatal(n)
	}
	if err = inventory.Rename(ctx, s, "admin", "missing", "new", "old"); !errors.Is(err, auth.ErrNotFound) {
		t.Fatal(err)
	}
}

func TestBatchConcurrentSameKeyAndRevocation(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a := auth.NewAgents(s, "https://panel.test")
	token := batchToken(t, a, 1)
	request := auth.RegisterRequest{Token: token.Token, PublicKey: registrationKey(t), ProtocolVersion: "1.0"}
	var wg sync.WaitGroup
	ids := make([]string, 10)
	errs := make([]error, 10)
	for i := range ids {
		wg.Add(1)
		go func() { defer wg.Done(); ids[i], errs[i] = a.Register(ctx, request) }()
	}
	wg.Wait()
	for i := range ids {
		if errs[i] != nil || ids[i] == "" || ids[i] != ids[0] {
			t.Fatal(ids, errs)
		}
	}
	if err := a.RevokeRegistrationToken(ctx, "admin", token.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Register(ctx, request); !errors.Is(err, auth.ErrUnauthorized) {
		t.Fatal("revoked retry accepted", err)
	}
	if _, err := a.Challenge(ctx, ids[0]); err != nil {
		t.Fatal("revoking batch token revoked node", err)
	}
	tokens, err := a.RegistrationTokens(ctx, 10, "")
	if err != nil || tokens[0].UsedCount != 1 {
		t.Fatal(tokens, err)
	}
}
