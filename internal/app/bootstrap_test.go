package app

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/platform/config"
	"github.com/vioira/viorka/internal/storage"
)

func TestBootstrapAdmin(t *testing.T) {
	for _, supplied := range []bool{false, true} {
		name := "generated"
		if supplied {
			name = "supplied"
		}
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			cfg := config.Config{DatabasePath: filepath.Join(t.TempDir(), "panel.db"), AdminUsername: "owner"}
			store, err := storage.Open(ctx, cfg.DatabasePath)
			if err != nil {
				t.Fatal(err)
			}
			defer store.Close()
			users, err := auth.New(store)
			if err != nil {
				t.Fatal(err)
			}
			password := "test-private-password"
			if supplied {
				cfg.AdminPasswordFile = filepath.Join(t.TempDir(), "password")
				if err := os.WriteFile(cfg.AdminPasswordFile, []byte(password+"\n"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if err := bootstrapAdmin(ctx, cfg, store, users); err != nil {
				t.Fatal(err)
			}
			files, err := filepath.Glob(cfg.DatabasePath + ".initial-password-*")
			if err != nil {
				t.Fatal(err)
			}
			if supplied {
				if len(files) != 0 {
					t.Fatal("generated unnecessary password")
				}
			} else {
				if len(files) != 1 {
					t.Fatalf("password files: %v", files)
				}
				info, err := os.Stat(files[0])
				if err != nil {
					t.Fatal(err)
				}
				if info.Mode().Perm() != 0600 {
					t.Fatal("unsafe permissions")
				}
				b, err := os.ReadFile(files[0])
				if err != nil {
					t.Fatal(err)
				}
				password = strings.TrimSuffix(string(b), "\n")
				if len(password) != 32 {
					t.Fatal("incorrect password length")
				}
			}
			if _, _, err := users.Login(ctx, "owner", password); err != nil {
				t.Fatal(err)
			}
			cfg.AdminUsername = "another"
			cfg.AdminPasswordFile = "/nonexistent/password"
			if err := bootstrapAdmin(ctx, cfg, store, users); err != nil {
				t.Fatal(err)
			}
			if _, _, err := users.Login(ctx, "owner", password); err != nil {
				t.Fatal("restart changed password", err)
			}
			if _, err := store.UserByName(ctx, "another"); err == nil {
				t.Fatal("restart created extra administrator")
			}
		})
	}
}

func TestBootstrapFailureLeavesUserTableEmpty(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "panel.db")
	store, err := storage.Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	users, err := auth.New(store)
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{AdminUsername: "admin", DatabasePath: filepath.Join(t.TempDir(), "missing", "panel.db")}
	if err := bootstrapAdmin(ctx, cfg, store, users); err == nil {
		t.Fatal("accepted missing password directory")
	}
	exists, err := store.HasUsers(ctx)
	if err != nil || exists {
		t.Fatalf("created inaccessible account: %v %v", exists, err)
	}
}
