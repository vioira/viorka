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

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/vioira/viorka/internal/realtime"
	"github.com/vioira/viorka/migrations"
)

// OpenPostgres uses path only for private local keys and recovery artifacts.
// The connection URL is never used as a filename or included in errors.
func OpenPostgres(ctx context.Context, connectionURL, path string) (*Store, error) {
	u, err := url.Parse(connectionURL)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") {
		return nil, fmt.Errorf("invalid PostgreSQL connection configuration")
	}
	query := u.Query()
	if query.Get("sslmode") == "" {
		query.Set("sslmode", "verify-full")
		u.RawQuery = query.Encode()
	}
	cfg, err := pgx.ParseConfig(u.String())
	if err != nil {
		return nil, fmt.Errorf("invalid PostgreSQL connection configuration")
	}
	cfg.ConnectTimeout = 5 * time.Second
	cfg.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	cfg.RuntimeParams["timezone"] = "UTC"
	cfg.RuntimeParams["statement_timeout"] = "30000"
	cfg.RuntimeParams["lock_timeout"] = "5000"
	cfg.RuntimeParams["idle_in_transaction_session_timeout"] = "30000"
	db := sql.OpenDB(postgresConnector{stdlib.GetConnector(*cfg)})
	// Preserve the current single-Panel serialized transaction model.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	success := false
	defer func() {
		if !success {
			db.Close()
		}
	}()
	if err = db.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("connect PostgreSQL: %w", err)
	}
	var version int
	if err = db.QueryRowContext(ctx, `SHOW server_version_num`).Scan(&version); err != nil {
		return nil, err
	}
	if version < 160000 {
		return nil, fmt.Errorf("PostgreSQL 16 or newer is required")
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(filepath.Dir(absolute), 0700); err != nil {
		return nil, err
	}
	keyPath := absolute + ".engine-key"
	if _, err = os.Lstat(keyPath); os.IsNotExist(err) {
		var exists bool
		if err = db.QueryRowContext(ctx, `SELECT to_regclass('engine_operations') IS NOT NULL`).Scan(&exists); err != nil {
			return nil, err
		}
		if exists {
			var encrypted bool
			if err = db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM engine_operations) OR EXISTS(SELECT 1 FROM engine_credentials) OR EXISTS(SELECT 1 FROM engine_targets) OR EXISTS(SELECT 1 FROM outbound_configs) OR EXISTS(SELECT 1 FROM backup_policy WHERE secret_encrypted!='') OR EXISTS(SELECT 1 FROM engine_recovery_metadata) OR EXISTS(SELECT 1 FROM subscription_restore_engines WHERE observed_encrypted!='')`).Scan(&encrypted); err != nil {
				return nil, err
			}
			if encrypted {
				return nil, fmt.Errorf("engine encryption key missing; restore the matching key before opening this database")
			}
		}
	}
	key, err := loadEngineKey(keyPath)
	if err != nil {
		return nil, err
	}
	s := &Store{db: db, events: realtime.New(), engineKey: key, postgres: true, localPath: absolute}
	if err = s.migratePostgres(ctx); err != nil {
		return nil, err
	}
	success = true
	return s, nil
}

func (s *Store) migratePostgres(ctx context.Context) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Concurrent initialization must never apply the same schema twice.
	if _, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(763491120)`); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY,sha256 TEXT NOT NULL)`); err != nil {
		return err
	}
	files, err := migrations.PostgresFiles.ReadDir("postgres")
	if err != nil {
		return err
	}
	known := map[string]string{}
	for _, file := range files {
		data, err := migrations.PostgresFiles.ReadFile("postgres/" + file.Name())
		if err != nil {
			return err
		}
		hash := sha256.Sum256(data)
		known[file.Name()] = hex.EncodeToString(hash[:])
	}
	rows, err := tx.QueryContext(ctx, `SELECT version,sha256 FROM schema_migrations`)
	if err != nil {
		return err
	}
	applied := map[string]bool{}
	for rows.Next() {
		var version, hash string
		if err = rows.Scan(&version, &hash); err != nil {
			rows.Close()
			return err
		}
		if known[version] != hash {
			rows.Close()
			return fmt.Errorf("unknown or modified PostgreSQL migration %s", version)
		}
		applied[version] = true
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, file := range files {
		if applied[file.Name()] {
			continue
		}
		data, err := migrations.PostgresFiles.ReadFile("postgres/" + file.Name())
		if err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, string(data)); err != nil {
			return fmt.Errorf("PostgreSQL migration %s: %w", file.Name(), err)
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO schema_migrations(version,sha256) VALUES(?,?)`, file.Name(), known[file.Name()]); err != nil {
			return err
		}
	}
	return tx.Commit()
}
