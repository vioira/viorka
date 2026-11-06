package settings

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/vioira/viorka/internal/auth"
)

type backupTestStore struct {
	policy BackupPolicy
	fail   bool
	calls  int
}

func (s *backupTestStore) Backup(_ context.Context, path string) error {
	s.calls++
	if s.fail {
		return errors.New("snapshot unavailable")
	}
	return os.WriteFile(path, []byte("snapshot"), 0600)
}
func (*backupTestStore) AuditSystem(context.Context, string, string, string) error { return nil }
func (s *backupTestStore) BackupPolicy(context.Context) (BackupPolicy, error)      { return s.policy, nil }
func (s *backupTestStore) SaveBackupPolicy(_ context.Context, _ string, p BackupPolicy) error {
	if p.Revision != s.policy.Revision {
		return auth.ErrConflict
	}
	p.Revision++
	s.policy = p
	return nil
}
func testBackups(t *testing.T) (*Backups, *backupTestStore) {
	t.Helper()
	s := &backupTestStore{policy: BackupPolicy{Revision: 1, Enabled: true, Cron: "* * * * *", RetentionDays: 14, MaxCopies: 2}}
	b, err := NewBackups(filepath.Join(t.TempDir(), "db"), s, func(context.Context, string) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	return b, s
}
func TestBackupCronValidation(t *testing.T) {
	p := BackupPolicy{Revision: 1, Cron: "0 2 * * *"}
	for _, expression := range []string{"0 2 * * *", "*/15 1-4 * * 1,3,5", "0 0 1 * MON"} {
		p.Cron = expression
		if err := ValidateBackupPolicy(p); err != nil {
			t.Fatal(expression, err)
		}
	}
	for _, expression := range []string{"@daily", "0 0 2 * * *", "60 2 * * *", "0 25 * * *", "CRON_TZ=Asia/Taipei 0 2 * * *"} {
		p.Cron = expression
		if ValidateBackupPolicy(p) == nil {
			t.Fatal("accepted", expression)
		}
	}
	p.Cron = "0 2 * * *"
	p.S3 = S3Config{Enabled: true, Endpoint: "http://example.com", Bucket: "backups", Region: "region", AccessKey: "key", SecretKey: "secret"}
	if ValidateBackupPolicy(p) == nil {
		t.Fatal("insecure endpoint accepted")
	}
}
func TestBackupScheduleRetentionAndPendingProtection(t *testing.T) {
	b, s := testBackups(t)
	ctx := context.Background()
	now := time.Now().UTC()
	if err := b.scheduled(ctx, nil, now); err != nil {
		t.Fatal(err)
	}
	if err := b.scheduled(ctx, nil, now); err != nil {
		t.Fatal(err)
	}
	if s.calls != 1 {
		t.Fatal("duplicate scheduled run", s.calls)
	}
	list, _ := b.List()
	first := list[0]
	if first.Trigger != "scheduled" || first.Status != "succeeded" || first.ExpiresAt == nil {
		t.Fatal(first)
	}
	if err := b.PrepareRestore(ctx, "", first.ID); err != nil {
		t.Fatal(err)
	}
	if err := b.Delete(ctx, "", first.ID); !errors.Is(err, auth.ErrConflict) {
		t.Fatal("deleted restore target", err)
	}
	s.policy.MaxCopies = 1
	second, err := b.Create(ctx, "manual")
	if err != nil {
		t.Fatal(err)
	}
	list, _ = b.List()
	if len(list) != 2 {
		t.Fatal("pending record pruned", list)
	}
	if err = b.CancelRestore(ctx, ""); err != nil {
		t.Fatal(err)
	}
	// Explicit expiry also applies while automatic creation is disabled.
	first.CreatedAt = time.Now().Add(-15 * 24 * time.Hour)
	if err = b.record(first); err != nil {
		t.Fatal(err)
	}
	s.policy.Enabled = false
	if err = b.scheduled(ctx, nil, now); err != nil {
		t.Fatal(err)
	}
	list, _ = b.List()
	if len(list) != 1 || list[0].ID != second.ID {
		t.Fatal(list)
	}
	if err = b.Delete(ctx, "", second.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = b.Download(second.ID); !errors.Is(err, auth.ErrNotFound) {
		t.Fatal(err)
	}
}
func TestBackupFailureUnlimitedAndRecovery(t *testing.T) {
	b, s := testBackups(t)
	ctx := context.Background()
	s.policy.RetentionDays = 0
	s.policy.MaxCopies = 0
	for range 3 {
		v, err := b.Create(ctx, "manual")
		if err != nil || v.ExpiresAt != nil {
			t.Fatal(v, err)
		}
	}
	s.fail = true
	v, err := b.Create(ctx, "manual")
	if err == nil || v.Status != "failed" {
		t.Fatal(v, err)
	}
	list, _ := b.List()
	if len(list) != 4 {
		t.Fatal(list)
	}
	if _, err = b.Download(v.ID); !errors.Is(err, auth.ErrConflict) {
		t.Fatal(err)
	}
	v.Status = "running"
	if err = b.record(v); err != nil {
		t.Fatal(err)
	}
	restarted, err := NewBackups(b.dir[:len(b.dir)-8], s, b.validate)
	if err != nil {
		t.Fatal(err)
	}
	recovered, err := restarted.readRecord(v.ID)
	if err != nil || recovered.Status != "failed" {
		t.Fatal(recovered, err)
	}
}
func TestBackupPolicySecretPreservationAndRecordEncryption(t *testing.T) {
	b, s := testBackups(t)
	ctx := context.Background()
	p := s.policy
	p.S3.SecretKey = "sensitive-secret"
	p.S3.AccessKey = "access-key"
	saved, err := b.SavePolicy(ctx, "", p)
	if err != nil {
		t.Fatal(err)
	}
	public := saved.Public()
	if public.S3.SecretKey != "" || !public.S3.SecretConfigured {
		t.Fatal("secret exposed")
	}
	if _, err = b.SavePolicy(ctx, "", p); !errors.Is(err, auth.ErrConflict) {
		t.Fatal(err)
	}
	saved, err = b.SavePolicy(ctx, "", public)
	if err != nil || saved.S3.SecretKey != "sensitive-secret" {
		t.Fatal(saved, err)
	}
	v, err := b.Create(ctx, "manual")
	if err != nil {
		t.Fatal(err)
	}
	v.Remote = &saved.S3
	if err = b.record(v); err != nil {
		t.Fatal(err)
	}
	recovered, err := b.readRecord(v.ID)
	if err != nil || recovered.Remote.SecretKey != "sensitive-secret" {
		t.Fatal(recovered, err)
	}
	data, err := os.ReadFile(filepath.Join(b.dir, v.ID+".record"))
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"sensitive-secret", "access-key"} {
		if strings.Contains(string(data), secret) {
			t.Fatal("plaintext secret in record")
		}
	}
}
