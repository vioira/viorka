package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEnvironmentFile(t *testing.T) {
	t.Chdir(t.TempDir())
	for _, key := range []string{"VIORKA_ENV_FILE", "VIORKA_LISTEN", "VIORKA_DATABASE", "VIORKA_ORIGIN", "VIORKA_ALLOWED_ORIGINS", "VIORKA_ADMIN_USERNAME", "VIORKA_ADMIN_PASSWORD_FILE", "VIORKA_TLS_CERT", "VIORKA_TLS_KEY"} {
		old, ok := os.LookupEnv(key)
		os.Unsetenv(key)
		t.Cleanup(func() {
			if ok {
				os.Setenv(key, old)
			} else {
				os.Unsetenv(key)
			}
		})
	}
	cfg, err := FromEnv()
	if err != nil || cfg.AdminUsername != "admin" {
		t.Fatalf("defaults: %+v %v", cfg, err)
	}
	if err := os.WriteFile(".env", []byte("# config\nVIORKA_ORIGIN='https://localhost:5173'\nVIORKA_ADMIN_USERNAME=owner\nVIORKA_DATABASE=\"data/my panel.db\"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	cfg, err = FromEnv()
	if err != nil || cfg.AdminUsername != "owner" || cfg.DatabasePath != "data/my panel.db" || cfg.Origin != "https://localhost:5173" {
		t.Fatalf("file: %+v %v", cfg, err)
	}
	t.Setenv("VIORKA_ADMIN_USERNAME", "override")
	cfg, err = FromEnv()
	if err != nil || cfg.AdminUsername != "override" {
		t.Fatalf("override: %+v %v", cfg, err)
	}
	t.Setenv("VIORKA_ADMIN_USERNAME", "")
	cfg, err = FromEnv()
	if err != nil || cfg.AdminUsername != "admin" {
		t.Fatalf("explicit empty: %+v %v", cfg, err)
	}
	t.Setenv("VIORKA_ENV_FILE", filepath.Join(t.TempDir(), "missing"))
	if _, err = FromEnv(); err == nil {
		t.Fatal("explicit missing file accepted")
	}
	t.Setenv("VIORKA_ENV_FILE", ".env")
	os.WriteFile(".env", []byte("SECRET='must-not-leak\n"), 0600)
	if _, err = FromEnv(); err == nil || strings.Contains(err.Error(), "must-not-leak") {
		t.Fatalf("invalid input: %v", err)
	}
}

func TestAllowedOrigins(t *testing.T) {
	t.Chdir(t.TempDir())
	t.Setenv("VIORKA_ENV_FILE", "")
	t.Setenv("VIORKA_LISTEN", "127.0.0.1:8080")
	t.Setenv("VIORKA_ORIGIN", "https://panel.example.com")
	t.Setenv("VIORKA_TLS_CERT", "")
	t.Setenv("VIORKA_TLS_KEY", "")
	for _, value := range []string{"*", "null", "https://*.example.com", "https://example.com/", "https://example.com?", "https://example.com#", "https://user@example.com", "http://example.com", "https://example.com,", strings.Repeat("https://example.com,", 32) + "https://example.com"} {
		t.Setenv("VIORKA_ALLOWED_ORIGINS", value)
		if _, err := FromEnv(); err == nil {
			t.Errorf("accepted %q", value)
		}
	}
	t.Setenv("VIORKA_ALLOWED_ORIGINS", " https://console.example.com, http://localhost:5173,https://console.example.com ")
	c, err := FromEnv()
	if err != nil || len(c.AllowedOrigins) != 2 {
		t.Fatalf("%+v %v", c, err)
	}
	t.Setenv("VIORKA_ALLOWED_ORIGINS", "")
	c, err = FromEnv()
	if err != nil || len(c.AllowedOrigins) != 0 {
		t.Fatalf("empty: %+v %v", c, err)
	}
}
