package settings_test

import (
	"context"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/settings"
	"github.com/vioira/viorka/internal/storage"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestEncryptedBackupRestoreAndTamper(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "panel.db")
	store, e := storage.Open(ctx, path)
	if e != nil {
		t.Fatal(e)
	}
	if e = store.Bootstrap(ctx, auth.User{ID: "u", Username: "original", Role: "admin", PasswordHash: "test-hash"}); e != nil {
		t.Fatal(e)
	}
	if e = store.InitSettings(ctx, "https://panel.example.com"); e != nil {
		t.Fatal(e)
	}
	service, e := settings.NewBackups(path, store, storage.ValidateSnapshot)
	if e != nil {
		t.Fatal(e)
	}
	snapshot, e := service.Create(ctx, "u")
	if e != nil {
		t.Fatal(e)
	}
	file := filepath.Join(path+".backups", snapshot.ID+".backup")
	encrypted, e := os.ReadFile(file)
	if e != nil {
		t.Fatal(e)
	}
	if strings.Contains(string(encrypted), "SQLite format") || strings.Contains(string(encrypted), "test-hash") {
		t.Fatal("unencrypted backup")
	}
	info, _ := os.Stat(file)
	if info.Mode().Perm() != 0600 {
		t.Fatal(info.Mode())
	}
	v, _ := store.Settings(ctx)
	v.PanelName = "changed"
	if _, e = settings.New(store).Save(ctx, "u", v); e != nil {
		t.Fatal(e)
	}
	if e = service.PrepareRestore(ctx, "u", snapshot.ID); e != nil {
		t.Fatal(e)
	}
	if e = service.PrepareRestore(ctx, "u", snapshot.ID); e != auth.ErrConflict {
		t.Fatal("duplicate restore accepted", e)
	}
	if e = store.SaveSession(ctx, "session", auth.Session{User: auth.User{ID: "u", PasswordHash: "test-hash"}, CSRF: "csrf", ExpiresAt: time.Now().Add(time.Hour)}); e != nil {
		t.Fatal(e)
	}
	store.Close()
	// No live connections are present when startup applies the validated plan.
	startup, e := settings.NewBackups(path, nil, storage.ValidateSnapshot)
	if e != nil {
		t.Fatal(e)
	}
	if e = startup.ApplyPending(ctx, path, storage.PrepareRestoredSnapshot, storage.CheckpointBeforeRestore); e != nil {
		t.Fatal(e)
	}
	store, e = storage.Open(ctx, path)
	if e != nil {
		t.Fatal(e)
	}
	defer store.Close()
	v, e = store.Settings(ctx)
	if e != nil || v.PanelName != "Viorka" {
		t.Fatal("restore did not recover settings", v, e)
	}
	if _, e = store.Session(ctx, "session"); e != auth.ErrUnauthorized {
		t.Fatal("session survived restore", e)
	}
	recovery, _ := filepath.Glob(path + ".before-restore-*")
	if len(recovery) == 0 {
		t.Fatal("no recovery copy")
	}
	if id, e := startup.Pending(); id != "" || e != nil {
		t.Fatal(id, e)
	}
	service, e = settings.NewBackups(path, store, storage.ValidateSnapshot)
	if e != nil {
		t.Fatal(e)
	}
	encrypted[len(encrypted)-1] ^= 1
	if e = os.WriteFile(file, encrypted, 0600); e != nil {
		t.Fatal(e)
	}
	if e = service.PrepareRestore(ctx, "u", snapshot.ID); e == nil {
		t.Fatal("tampered snapshot accepted")
	}
	if e = service.PrepareRestore(ctx, "u", "../../etc/passwd"); e != auth.ErrInvalid {
		t.Fatal(e)
	}
}
