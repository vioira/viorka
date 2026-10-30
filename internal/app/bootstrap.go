package app

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/platform/config"
	"github.com/vioira/viorka/internal/storage"
)

func bootstrapAdmin(ctx context.Context, cfg config.Config, store *storage.Store, users *auth.Service) error {
	exists, err := store.HasUsers(ctx)
	if err != nil {
		return err
	}
	if exists {
		return nil
	}
	var password string
	generatedPath := ""
	if cfg.AdminPasswordFile != "" {
		info, err := os.Lstat(cfg.AdminPasswordFile)
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Size() > 1024 {
			return fmt.Errorf("bootstrap password file must be a private regular file and at most 1024 bytes")
		}
		b, err := os.ReadFile(cfg.AdminPasswordFile)
		if err != nil {
			return err
		}
		password = strings.TrimSuffix(string(b), "\n")
	} else {
		var random [24]byte
		if _, err := rand.Read(random[:]); err != nil {
			return err
		}
		password = base64.RawURLEncoding.EncodeToString(random[:])
		// Persist before committing the account so a crash cannot lose its password.
		f, err := os.CreateTemp(filepath.Dir(cfg.DatabasePath), filepath.Base(cfg.DatabasePath)+".initial-password-*")
		if err != nil {
			return fmt.Errorf("create initial password file: %w", err)
		}
		generatedPath = f.Name()
		_, writeErr := f.WriteString(password + "\n")
		if writeErr == nil {
			writeErr = f.Sync()
		}
		closeErr := f.Close()
		if writeErr != nil {
			return fmt.Errorf("save initial password: %w", writeErr)
		}
		if closeErr != nil {
			return closeErr
		}
	}
	if err := users.Bootstrap(ctx, cfg.AdminUsername, password); err != nil {
		return err
	}
	if generatedPath != "" {
		slog.Info("initial administrator created; read password file and remove it after changing password", "username", cfg.AdminUsername, "password_file", generatedPath)
	}
	return nil
}
