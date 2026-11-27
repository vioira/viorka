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
	var publication, category int64
	if e = db.QueryRowContext(ctx, `SELECT revision,category_revision FROM status_publication WHERE id=1`).Scan(&publication, &category); e != nil {
		return fmt.Errorf("invalid status publication: %w", e)
	}
	var invalidUpdates int
	if e = db.QueryRowContext(ctx, `SELECT count(*) FROM nodes WHERE agent_auto_update NOT IN (0,1) OR agent_update_capable NOT IN (0,1) OR agent_management_connected NOT IN (0,1)`).Scan(&invalidUpdates); e != nil || invalidUpdates > 0 {
		return fmt.Errorf("invalid Agent update policy in snapshot")
	}
	var invalidShadowsocks bool
	if e = db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM nodes WHERE ss_outbound_capable NOT IN (0,1)) OR EXISTS(SELECT 1 FROM engine_targets WHERE requires_ss_outbound NOT IN (0,1)) OR EXISTS(SELECT 1 FROM engine_operations WHERE requires_ss_outbound NOT IN (0,1))`).Scan(&invalidShadowsocks); e != nil || invalidShadowsocks {
		return fmt.Errorf("invalid Shadowsocks capability metadata in snapshot")
	}
	for _, table := range []string{"agent_release_assets", "status_nodes", "node_categories", "node_category_members", "status_exchange_rates"} {
		var exists int
		if e = db.QueryRowContext(ctx, "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?", table).Scan(&exists); e != nil {
			return e
		}
		if exists != 1 {
			return fmt.Errorf("missing snapshot table %s", table)
		}
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
	tx, e := db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	_, e = tx.ExecContext(ctx, `DELETE FROM alert_deliveries; DELETE FROM alert_states; UPDATE alert_channels SET secret_encrypted='',last_state='',last_at='',last_detail=''; UPDATE nodes SET agent_management_connected=0,agent_auto_update=0,agent_update_capable=0, outage_since=NULL,offline_alert_since=NULL; UPDATE backup_policy SET enabled=0,s3_json=json_set(s3_json,'$.enabled',json('false')),secret_encrypted='',revision=revision+1; UPDATE system_settings SET auto_backup=0,revision=revision+1; UPDATE node_registration_tokens SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE revoked_at IS NULL; DELETE FROM web_sessions; DELETE FROM agent_sessions; DELETE FROM agent_challenges; DELETE FROM user_invitations; UPDATE nodes SET enrollment_revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE enrollment_token_hash IS NOT NULL AND enrollment_revoked_at IS NULL; UPDATE nodes SET state='offline' WHERE state='online'; UPDATE tasks SET state='failed',last_error='Panel database restored' WHERE state IN ('queued','dispatched','accepted','running'); UPDATE managed_engine_recoveries SET snapshot_encrypted='' WHERE snapshot_encrypted!=''; UPDATE engine_operations SET active=0 WHERE task_id IN (SELECT id FROM tasks WHERE state='failed' AND last_error='Panel database restored'); UPDATE subscriptions SET token_hash=NULL,version=version+1; DELETE FROM subscription_restore_endpoints; DELETE FROM subscription_restore_engines; INSERT INTO subscription_restore_engines(engine_id,restored_at,state) SELECT id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'pending' FROM engines WHERE ownership='managed';`)
	if e != nil {
		return e
	}
	if e = tx.Commit(); e != nil {
		return e
	}
	var busy, log, checkpointed int
	if e = db.QueryRowContext(ctx, `PRAGMA wal_checkpoint(TRUNCATE)`).Scan(&busy, &log, &checkpointed); e != nil {
		return e
	}
	if busy != 0 {
		return fmt.Errorf("restored snapshot is busy")
	}
	return nil
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
