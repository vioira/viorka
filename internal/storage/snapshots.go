package storage

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"github.com/vioira/viorka/migrations"
	"net/url"
	"path/filepath"
)

func snapshotDB(path string, readOnly bool) (*sql.DB, error) {
	absolute, e := filepath.Abs(path)
	if e != nil {
		return nil, e
	}
	u := url.URL{Scheme: "file", Path: absolute}
	q := u.Query()
	if readOnly {
		q.Set("mode", "ro")
	}
	q.Add("_pragma", "foreign_keys(1)")
	u.RawQuery = q.Encode()
	db, e := sql.Open("sqlite", u.String())
	if e == nil {
		db.SetMaxOpenConns(1)
	}
	return db, e
}
func ValidateSnapshot(ctx context.Context, path string) error {
	db, e := snapshotDB(path, true)
	if e != nil {
		return e
	}
	defer db.Close()
	var result string
	if e = db.QueryRowContext(ctx, `PRAGMA quick_check`).Scan(&result); e != nil {
		return e
	}
	if result != "ok" {
		return fmt.Errorf("invalid snapshot integrity")
	}
	rows, e := db.QueryContext(ctx, `PRAGMA foreign_key_check`)
	if e != nil {
		return e
	}
	bad := rows.Next()
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	if bad {
		return fmt.Errorf("snapshot has foreign key violations")
	}
	files, e := migrations.Files.ReadDir(".")
	if e != nil {
		return e
	}
	var count int
	if e = db.QueryRowContext(ctx, `SELECT count(*) FROM schema_migrations`).Scan(&count); e != nil {
		return e
	}
	if count != len(files) {
		return fmt.Errorf("incompatible snapshot schema")
	}
	for _, file := range files {
		data, e := migrations.Files.ReadFile(file.Name())
		if e != nil {
			return e
		}
		sum := sha256.Sum256(data)
		var hash string
		if e = db.QueryRowContext(ctx, `SELECT sha256 FROM schema_migrations WHERE version=? OR (?='0002_auth_and_task_leases.up.sql' AND version='0002_m0.up.sql')`, file.Name(), file.Name()).Scan(&hash); e != nil {
			return e
		}
		if hash != hex.EncodeToString(sum[:]) {
			return fmt.Errorf("snapshot schema mismatch")
		}
	}
	return nil
}
func PrepareRestoredSnapshot(ctx context.Context, path string) error {
	db, e := snapshotDB(path, false)
	if e != nil {
		return e
	}
	defer db.Close()
	_, e = db.ExecContext(ctx, `DELETE FROM web_sessions; DELETE FROM agent_sessions; DELETE FROM agent_challenges; DELETE FROM user_invitations; UPDATE nodes SET enrollment_revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE enrollment_token_hash IS NOT NULL AND enrollment_revoked_at IS NULL; UPDATE nodes SET state='offline' WHERE state='online'; UPDATE tasks SET state='failed',last_error='Panel database restored' WHERE state IN ('queued','dispatched','accepted','running');`)
	if e != nil {
		return e
	}
	_, e = db.ExecContext(ctx, `PRAGMA wal_checkpoint(TRUNCATE)`)
	return e
}

// CheckpointBeforeRestore requires exclusive process ownership and no application connections.
func CheckpointBeforeRestore(ctx context.Context, path string) error {
	db, e := snapshotDB(path, false)
	if e != nil {
		return e
	}
	defer db.Close()
	var busy, log, checkpointed int
	if e = db.QueryRowContext(ctx, `PRAGMA wal_checkpoint(TRUNCATE)`).Scan(&busy, &log, &checkpointed); e != nil {
		return e
	}
	if busy != 0 {
		return fmt.Errorf("database is busy; stop all Panel processes before restoring")
	}
	return nil
}
