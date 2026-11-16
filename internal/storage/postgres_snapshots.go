package storage

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/vioira/viorka/migrations"
)

// PostgreSQL backups use the existing validated SQLite snapshot format. A
// repeatable-read transaction supplies one consistent view across all tables;
// SQLite constraints and schema checks remain part of every backup and restore.
func (s *Store) backupPostgres(ctx context.Context, path string) (err error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	defer func() {
		if err != nil {
			os.Remove(path)
		}
	}()
	snapshot, err := snapshotDB(path, false)
	if err != nil {
		return err
	}
	defer snapshot.Close()
	dest, err := snapshot.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer dest.Rollback()
	if _, err = dest.ExecContext(ctx, `CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,sha256 TEXT NOT NULL)`); err != nil {
		return err
	}
	files, err := migrations.Files.ReadDir(".")
	if err != nil {
		return err
	}
	for _, file := range files {
		data, e := migrations.Files.ReadFile(file.Name())
		if e != nil {
			return e
		}
		if _, err = dest.ExecContext(ctx, string(data)); err != nil {
			return err
		}
		hash := sha256.Sum256(data)
		if _, err = dest.ExecContext(ctx, `INSERT INTO schema_migrations VALUES(?,?)`, file.Name(), hex.EncodeToString(hash[:])); err != nil {
			return err
		}
	}
	tables, err := snapshotTables(ctx, dest)
	if err != nil {
		return err
	}
	// The only rows here are schema defaults; defer references until commit.
	if _, err = dest.ExecContext(ctx, `PRAGMA defer_foreign_keys=ON`); err != nil {
		return err
	}
	for _, table := range tables {
		if _, err = dest.ExecContext(ctx, `DELETE FROM `+quoteIdentifier(table)); err != nil {
			return err
		}
	}
	source, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return err
	}
	defer source.Rollback()
	for _, table := range tables {
		if err = copySnapshotTable(ctx, source, dest, table); err != nil {
			return fmt.Errorf("snapshot table %s: %w", table, err)
		}
	}
	if err = source.Commit(); err != nil {
		return err
	}
	if err = dest.Commit(); err != nil {
		return err
	}
	return ValidateSnapshot(ctx, path)
}

func quoteIdentifier(value string) string { return `"` + strings.ReplaceAll(value, `"`, `""`) + `"` }

func snapshotTables(ctx context.Context, tx *sql.Tx) ([]string, error) {
	rows, err := tx.QueryContext(ctx, `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='schema_migrations' ORDER BY rowid`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var tables []string
	for rows.Next() {
		var table string
		if err = rows.Scan(&table); err != nil {
			return nil, err
		}
		tables = append(tables, table)
	}
	return tables, rows.Err()
}

func copySnapshotTable(ctx context.Context, source, dest *sql.Tx, table string) error {
	rows, err := source.QueryContext(ctx, `SELECT * FROM `+quoteIdentifier(table))
	if err != nil {
		return err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return err
	}
	quoted := make([]string, len(columns))
	marks := make([]string, len(columns))
	values := make([]any, len(columns))
	pointers := make([]any, len(columns))
	for i, column := range columns {
		quoted[i] = quoteIdentifier(column)
		marks[i] = "?"
		pointers[i] = &values[i]
	}
	query := `INSERT INTO ` + quoteIdentifier(table) + ` (` + strings.Join(quoted, ",") + `) VALUES (` + strings.Join(marks, ",") + `)`
	for rows.Next() {
		if err = rows.Scan(pointers...); err != nil {
			return err
		}
		for i, value := range values {
			if b, ok := value.([]byte); ok {
				values[i] = string(b)
			}
		}
		if _, err = dest.ExecContext(ctx, query, values...); err != nil {
			return err
		}
	}
	return rows.Err()
}

// RestorePostgresSnapshot runs only during startup after an administrator has
// scheduled a restore. All application tables change atomically; a consistent
// pre-restore snapshot is retained before any destructive statement is run.
func (s *Store) RestorePostgresSnapshot(ctx context.Context, path string) error {
	if !s.postgres {
		return fmt.Errorf("PostgreSQL restore requires a PostgreSQL store")
	}
	if err := ValidateSnapshot(ctx, path); err != nil {
		return err
	}
	before := s.localPath + ".before-restore-" + time.Now().UTC().Format("20060102T150405.000000000") + ".bak"
	if err := s.Backup(ctx, before); err != nil {
		return err
	}
	snapshot, err := snapshotDB(path, true)
	if err != nil {
		return err
	}
	defer snapshot.Close()
	source, err := snapshot.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer source.Rollback()
	tables, err := snapshotTables(ctx, source)
	if err != nil {
		return err
	}
	dest, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer dest.Rollback()
	quoted := make([]string, len(tables))
	for i, table := range tables {
		quoted[i] = quoteIdentifier(table)
	}
	if _, err = dest.ExecContext(ctx, `TRUNCATE TABLE `+strings.Join(quoted, ",")+` RESTART IDENTITY`); err != nil {
		return err
	}
	for _, table := range tables {
		if err = copySnapshotTable(ctx, source, dest, table); err != nil {
			return fmt.Errorf("restore table %s: %w", table, err)
		}
	}
	if _, err = dest.ExecContext(ctx, `SELECT setval(pg_get_serial_sequence('subscription_accesses','id'),coalesce((SELECT max(id) FROM subscription_accesses),0)+1,false)`); err != nil {
		return err
	}
	return dest.Commit()
}
