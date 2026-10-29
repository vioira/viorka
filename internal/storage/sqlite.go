package storage

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"github.com/vioira/viorka/migrations"
	_ "modernc.org/sqlite"
)

type Store struct{ db *sql.DB }

func Open(ctx context.Context, path string) (*Store, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(filepath.Dir(absolute), 0700); err != nil {
		return nil, err
	}
	if info, e := os.Lstat(absolute); e == nil && (!info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0) {
		return nil, fmt.Errorf("database must be a private regular file (0600)")
	}
	f, err := os.OpenFile(absolute, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = f.Close(); err != nil {
		return nil, err
	}
	u := url.URL{Scheme: "file", Path: absolute}
	q := u.Query()
	q.Add("_pragma", "foreign_keys(1)")
	q.Add("_pragma", "busy_timeout(5000)")
	q.Add("_pragma", "journal_mode(WAL)")
	u.RawQuery = q.Encode()
	db, err := sql.Open("sqlite", u.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db}
	if err = s.migrate(ctx, absolute); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}
func (s *Store) Close() error                   { return s.db.Close() }
func (s *Store) Ping(ctx context.Context) error { return s.db.PingContext(ctx) }
func stamp(t time.Time) string                  { return t.UTC().Format(time.RFC3339Nano) }

// Fixed-width UTC is used in comparisons, avoiding fractional-second ordering ambiguity.
func now() string           { return at(time.Now()) }
func at(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000000000Z") }
func (s *Store) migrate(ctx context.Context, path string) error {
	if _, err := s.db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, sha256 TEXT NOT NULL)`); err != nil {
		return fmt.Errorf("migration metadata: %w", err)
	}
	files, err := migrations.Files.ReadDir(".")
	if err != nil {
		return err
	}
	known := map[string]string{}
	for _, f := range files {
		b, e := migrations.Files.ReadFile(f.Name())
		if e != nil {
			return e
		}
		h := sha256.Sum256(b)
		known[f.Name()] = hex.EncodeToString(h[:])
	}
	rows, err := s.db.QueryContext(ctx, `SELECT version,sha256 FROM schema_migrations`)
	if err != nil {
		return err
	}
	applied := map[string]bool{}
	for rows.Next() {
		var name, hash string
		if err = rows.Scan(&name, &hash); err != nil {
			rows.Close()
			return err
		}
		// Local databases may have recorded the original development filename.
		// The SQL checksum must still match; do not replay or rewrite its history.
		if name == "0002_m0.up.sql" {
			name = "0002_auth_and_task_leases.up.sql"
		}
		if known[name] != hash {
			rows.Close()
			return fmt.Errorf("unknown or modified migration %s", name)
		}
		applied[name] = true
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	var existingTables int
	if err = s.db.QueryRowContext(ctx, `SELECT count(*) FROM sqlite_master WHERE type='table' AND name!='schema_migrations'`).Scan(&existingTables); err != nil {
		return err
	}
	if existingTables > 0 && len(applied) < len(known) {
		if err = s.Backup(ctx, path+".before-"+time.Now().UTC().Format("20060102T150405.000000000")+".bak"); err != nil {
			return err
		}
	}
	for _, f := range files {
		if applied[f.Name()] {
			continue
		}
		b, _ := migrations.Files.ReadFile(f.Name())
		tx, e := s.db.BeginTx(ctx, nil)
		if e != nil {
			return e
		}
		if _, e = tx.ExecContext(ctx, string(b)); e == nil {
			_, e = tx.ExecContext(ctx, `INSERT INTO schema_migrations VALUES(?,?)`, f.Name(), known[f.Name()])
		}
		if e != nil {
			tx.Rollback()
			return fmt.Errorf("migration %s: %w", f.Name(), e)
		}
		if e = tx.Commit(); e != nil {
			return e
		}
	}
	return nil
}

// Backup uses SQLite's consistent online snapshot; the target must not already exist.
func (s *Store) Backup(ctx context.Context, path string) error {
	if _, err := os.Lstat(path); !os.IsNotExist(err) {
		return fmt.Errorf("backup target must not exist")
	}
	if _, err := s.db.ExecContext(ctx, `VACUUM INTO ?`, path); err != nil {
		return fmt.Errorf("backup: %w", err)
	}
	return os.Chmod(path, 0600)
}
