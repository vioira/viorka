package storage

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/settings"
)

func TestBackupPolicyStorageEncryptionConflictAndRestore(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "panel.db")
	s, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err = s.Bootstrap(ctx, auth.User{ID: "admin", Username: "admin", Role: "admin", PasswordHash: "hash"}); err != nil {
		t.Fatal(err)
	}
	if err = s.InitSettings(ctx, "https://panel.example.com"); err != nil {
		t.Fatal(err)
	}
	p, err := s.BackupPolicy(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if p.Enabled || p.MaxCopies != 0 {
		t.Fatalf("unexpected initial backup policy: %+v", p)
	}
	config, err := s.Settings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if config.AutoBackup {
		t.Fatal("automatic backup enabled on initialization")
	}
	// Exercise an explicitly enabled policy independently of the initialization default.
	p.Enabled = true
	p.S3 = settings.S3Config{Enabled: true, Bucket: "bucket", Region: "us-east-1", AccessKey: "key", SecretKey: "never-store-plaintext"}
	if err = s.SaveBackupPolicy(ctx, "admin", p); err != nil {
		t.Fatal(err)
	}
	if err = s.SaveBackupPolicy(ctx, "admin", p); !errors.Is(err, auth.ErrConflict) {
		t.Fatal("stale policy accepted", err)
	}
	var raw, encrypted string
	if err = s.db.QueryRow(`SELECT s3_json,secret_encrypted FROM backup_policy`).Scan(&raw, &encrypted); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(raw, p.S3.SecretKey) || strings.Contains(encrypted, p.S3.SecretKey) || encrypted == "" {
		t.Fatal("secret not encrypted")
	}
	saved, err := s.BackupPolicy(ctx)
	if err != nil || saved.S3.SecretKey != p.S3.SecretKey {
		t.Fatal(saved, err)
	}
	snapshot := filepath.Join(t.TempDir(), "snapshot.db")
	if err = s.Backup(ctx, snapshot); err != nil {
		t.Fatal(err)
	}
	if err = ValidateSnapshot(ctx, snapshot); err != nil {
		t.Fatal(err)
	}
	if err = PrepareRestoredSnapshot(ctx, snapshot); err != nil {
		t.Fatal(err)
	}
	db, err := snapshotDB(snapshot, true)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var enabled int
	if err = db.QueryRow(`SELECT enabled,secret_encrypted,s3_json FROM backup_policy`).Scan(&enabled, &encrypted, &raw); err != nil {
		t.Fatal(err)
	}
	if enabled != 0 || encrypted != "" || !strings.Contains(raw, `"enabled":false`) {
		t.Fatal("restore reenabled old storage credentials")
	}
}
