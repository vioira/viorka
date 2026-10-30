package storage

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/migrations"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	s, e := Open(context.Background(), filepath.Join(t.TempDir(), "test.db"))
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { s.Close() })
	if e = s.Bootstrap(context.Background(), auth.User{ID: "admin", Username: "admin", Role: "admin", PasswordHash: "not-used"}); e != nil {
		t.Fatal(e)
	}
	return s
}
func TestSQLiteMigrationBackupRestore(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "db")
	s, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	for _, pragma := range []string{"foreign_keys", "busy_timeout"} {
		var n int
		if err = s.db.QueryRow("PRAGMA " + pragma).Scan(&n); err != nil || n == 0 {
			t.Fatalf("%s: %d %v", pragma, n, err)
		}
	}
	if err = s.Bootstrap(ctx, auth.User{ID: "u", Username: "saved", PasswordHash: "hash", Role: "admin"}); err != nil {
		t.Fatal(err)
	}
	backup := filepath.Join(t.TempDir(), "snapshot.db")
	if err = s.Backup(ctx, backup); err != nil {
		t.Fatal(err)
	}
	if err = s.Backup(ctx, backup); err == nil {
		t.Fatal("backup overwritten")
	}
	s.Close()
	restored, err := Open(ctx, backup)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	if u, err := restored.UserByName(ctx, "saved"); err != nil || u.ID != "u" {
		t.Fatal("restore lost user", err)
	}
	s, err = Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(`UPDATE schema_migrations SET sha256='tampered'`); err != nil {
		t.Fatal(err)
	}
	s.Close()
	if _, err = Open(ctx, path); err == nil {
		t.Fatal("modified history accepted")
	}
}
func TestUpgradeAndRollback(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "legacy.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	first, _ := migrations.Files.ReadFile("0001_init.up.sql")
	if _, err = db.Exec(string(first)); err != nil {
		t.Fatal(err)
	}
	db.Close()
	os.Chmod(path, 0600)
	s, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	var n int
	if err = s.db.QueryRow(`SELECT count(*) FROM schema_migrations`).Scan(&n); err != nil || n != 3 {
		t.Fatal(n, err)
	}
	down3, e := os.ReadFile("../../migrations/0003_system_settings.down.sql")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.db.Exec(string(down3)); e != nil {
		t.Fatal(e)
	}
	down, err := os.ReadFile("../../migrations/0002_auth_and_task_leases.down.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(string(down)); err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(`SELECT * FROM web_sessions`); err == nil {
		t.Fatal("rollback did not remove session table")
	}
}

func TestRenamedMigrationPreservesExistingDatabase(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "existing.db")
	s, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Bootstrap(ctx, auth.User{ID: "saved", Username: "saved", PasswordHash: "hash", Role: "admin"}); err != nil {
		s.Close()
		t.Fatal(err)
	}
	if _, err = s.db.Exec(`UPDATE schema_migrations SET version=? WHERE version=?`, "0002_m0.up.sql", "0002_auth_and_task_leases.up.sql"); err != nil {
		s.Close()
		t.Fatal(err)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	if user, err := s.UserByName(ctx, "saved"); err != nil || user.ID != "saved" {
		s.Close()
		t.Fatal("renaming migration lost existing data", err)
	}
	var count int
	if err = s.db.QueryRow(`SELECT count(*) FROM schema_migrations`).Scan(&count); err != nil || count != 3 {
		s.Close()
		t.Fatal("migration history was duplicated", count, err)
	}
	if _, err = s.db.Exec(`UPDATE schema_migrations SET sha256='modified' WHERE version=?`, "0002_m0.up.sql"); err != nil {
		s.Close()
		t.Fatal(err)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	if reopened, err := Open(ctx, path); err == nil {
		reopened.Close()
		t.Fatal("legacy filename bypassed checksum validation")
	}
}

func TestAtomicEnrollmentAndExpiry(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a := auth.NewAgents(s, "https://test")
	v, err := a.CreateEnrollment(ctx, "admin", "node", "nat")
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := s.Enroll(ctx, auth.Hash(v.Token), auth.Random())
			results <- err
		}()
	}
	wg.Wait()
	close(results)
	success := 0
	for e := range results {
		if e == nil {
			success++
		}
	}
	if success != 1 {
		t.Fatalf("consumed %d times", success)
	}
	var nodes int
	if err = s.db.QueryRow(`SELECT count(*) FROM nodes`).Scan(&nodes); err != nil || nodes != 1 {
		t.Fatal("not atomic", nodes, err)
	}
	v, err = a.CreateEnrollment(ctx, "admin", "expired", "nat")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(`UPDATE nodes SET enrollment_expires_at=? WHERE id=?`, at(time.Now().Add(-time.Second)), v.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Enroll(ctx, auth.Hash(v.Token), "key"); err == nil {
		t.Fatal("expired token accepted")
	}
}
func TestTaskLeaseAttemptFencingAndRecovery(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	if _, err := s.db.Exec(`INSERT INTO nodes(id,name,kind,state,created_at) VALUES('n','node','nat','online',?)`, now()); err != nil {
		t.Fatal(err)
	}
	task, err := s.CreateTask(ctx, "admin", "n", "key")
	if err != nil {
		t.Fatal(err)
	}
	d, err := s.Claim(ctx, "n")
	if err != nil || d == nil {
		t.Fatal(err)
	}
	if other, err := s.Claim(ctx, "n"); err != nil || other != nil {
		t.Fatal("lease claimed twice")
	}
	if _, err = s.db.Exec(`UPDATE tasks SET lease_until=? WHERE id=?`, at(time.Now().Add(-time.Second)), task.ID); err != nil {
		t.Fatal(err)
	}
	d2, err := s.Claim(ctx, "n")
	if err != nil || d2 == nil || *d2.Attempt != 2 {
		t.Fatal("expired lease not recovered", err)
	}
	reply := v1.TaskReply{TaskID: task.ID, ResourceID: "n", Attempt: 1, State: "succeeded", Inspection: &v1.Inspection{OS: "linux", Arch: "amd64", Hostname: "real"}}
	if err = s.Reply(ctx, "n", "task.result", reply); err != auth.ErrConflict {
		t.Fatal("stale attempt accepted", err)
	}
	reply.Attempt = 2
	if err = s.Reply(ctx, "other", "task.result", reply); err == nil {
		t.Fatal("cross-node reply accepted")
	}
	if err = s.Reply(ctx, "n", "task.result", reply); err != nil {
		t.Fatal(err)
	}
	got, err := s.Task(ctx, task.ID)
	if err != nil || got.State != "succeeded" {
		t.Fatal(got, err)
	}
	if err = s.Recover(ctx); err != nil {
		t.Fatal(err)
	}
	nodes, err := s.Nodes(ctx, 50, "")
	if err != nil || nodes[0].State != "offline" {
		t.Fatal(nodes, err)
	}
}

func TestExpiredCredentialsAndOfflineTaskExpiry(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	session := auth.Session{User: auth.User{ID: "admin", PasswordHash: "not-used"}, CSRF: "csrf", ExpiresAt: time.Now().Add(-time.Minute)}
	if err := s.SaveSession(ctx, "hash", session); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Session(ctx, "hash"); err != auth.ErrUnauthorized {
		t.Fatal("expired session accepted", err)
	}
	if _, err := s.db.Exec(`INSERT INTO nodes(id,name,kind,state,created_at) VALUES('n','node','nat','offline',?)`, now()); err != nil {
		t.Fatal(err)
	}
	task, err := s.CreateTask(ctx, "admin", "n", "expire")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(`UPDATE tasks SET deadline_at=? WHERE id=?`, at(time.Now().Add(-time.Minute)), task.ID); err != nil {
		t.Fatal(err)
	}
	if err = s.Expire(ctx); err != nil {
		t.Fatal(err)
	}
	got, err := s.Task(ctx, task.ID)
	if err != nil || got.State != "failed" {
		t.Fatal("offline task not expired", got, err)
	}
}

func TestEnrollmentBelongsToPendingNode(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a := auth.NewAgents(s, "https://test")
	v, err := a.CreateEnrollment(ctx, "admin", "first", "nat")
	if err != nil {
		t.Fatal(err)
	}
	nodes, err := s.Nodes(ctx, 50, "")
	if err != nil || len(nodes) != 1 || nodes[0].ID != v.ID || nodes[0].Name != "first" || nodes[0].Kind != "nat" || nodes[0].State != "pending" {
		t.Fatal(nodes, err)
	}
	var tables int
	if err = s.db.QueryRow("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='enrollment_tokens'").Scan(&tables); err != nil || tables != 0 {
		t.Fatal("separate enrollment table remains", err)
	}
	var stored string
	if err = s.db.QueryRow("SELECT enrollment_token_hash FROM nodes WHERE id=?", v.ID).Scan(&stored); err != nil || stored != auth.Hash(v.Token) || stored == v.Token {
		t.Fatal("token storage", err)
	}
	id, err := s.Enroll(ctx, auth.Hash(v.Token), "key")
	if err != nil || id != v.ID {
		t.Fatal("enrollment changed node identity", id, err)
	}
	if again, err := s.Enroll(ctx, auth.Hash(v.Token), "key"); err != nil || again != id {
		t.Fatal("lost response recovery", again, err)
	}
	if _, err := s.Enroll(ctx, auth.Hash(v.Token), "other-key"); !errors.Is(err, auth.ErrUnauthorized) {
		t.Fatal("replay accepted", err)
	}
	nodes, err = s.Nodes(ctx, 50, "")
	if err != nil || len(nodes) != 1 || nodes[0].State != "offline" {
		t.Fatal("registration must not imply online", nodes, err)
	}

	second, err := a.CreateEnrollment(ctx, "admin", "second", "vps")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Enroll(ctx, auth.Hash(second.Token), "key"); !errors.Is(err, auth.ErrConflict) {
		t.Fatal("duplicate key accepted", err)
	}
	var used sql.NullString
	var state string
	if err = s.db.QueryRow("SELECT state,enrollment_used_at FROM nodes WHERE id=?", second.ID).Scan(&state, &used); err != nil || state != "pending" || used.Valid {
		t.Fatal("failed binding consumed token", state, used, err)
	}
	if id, err = s.Enroll(ctx, auth.Hash(second.Token), "new-key"); err != nil || id != second.ID {
		t.Fatal("rolled-back token cannot register", id, err)
	}

	for _, revoke := range []func(context.Context, string, string) error{s.RevokeEnrollment, s.RevokeNode} {
		v, err := a.CreateEnrollment(ctx, "admin", "revoked", "relay")
		if err != nil {
			t.Fatal(err)
		}
		if err = revoke(ctx, "admin", v.ID); err != nil {
			t.Fatal(err)
		}
		if _, err = s.Enroll(ctx, auth.Hash(v.Token), auth.Random()); !errors.Is(err, auth.ErrUnauthorized) {
			t.Fatal("revoked node token accepted", err)
		}
	}
	if _, err = a.CreateEnrollment(ctx, "missing-user", "invalid", "vps"); err == nil {
		t.Fatal("invalid actor accepted")
	}
	nodes, err = s.Nodes(ctx, 50, "")
	if err != nil || len(nodes) != 4 {
		t.Fatal("failed creation left a node", nodes, err)
	}
}
