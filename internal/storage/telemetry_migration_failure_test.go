package storage

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// Fail after all telemetry DDL has executed but before its migration receipt.
// This tests actual SQLite transactional rollback and a subsequent clean retry;
// it does not simulate power loss or claim a kill-before-fsync guarantee.
func TestTelemetryMigrationReceiptFailureRollsBackDDL(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "migration.db")
	s, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	schema := func(db *sql.DB) []string {
		t.Helper()
		rows, err := db.Query(`SELECT type||':'||name||':'||coalesce(sql,'') FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name!='fail_telemetry_receipt' ORDER BY type,name`)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var out []string
		for rows.Next() {
			var value string
			if err := rows.Scan(&value); err != nil {
				t.Fatal(err)
			}
			out = append(out, value)
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		return out
	}
	complete := schema(s.db)
	for _, file := range []string{"0010_telemetry_settings.down.sql", "0009_telemetry_history.down.sql"} {
		data, err := os.ReadFile(filepath.Join("../../migrations", file))
		if err != nil {
			t.Fatal(err)
		}
		if _, err = s.db.Exec(string(data)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = s.db.Exec(`DELETE FROM schema_migrations WHERE version IN ('0009_telemetry_history.up.sql','0010_telemetry_settings.up.sql')`); err != nil {
		t.Fatal(err)
	}
	before := schema(s.db)
	if _, err = s.db.Exec(`CREATE TRIGGER fail_telemetry_receipt BEFORE INSERT ON schema_migrations WHEN NEW.version='0009_telemetry_history.up.sql' BEGIN SELECT RAISE(ABORT,'injected telemetry receipt failure'); END`); err != nil {
		t.Fatal(err)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	if reopened, err := Open(ctx, path); err == nil {
		reopened.Close()
		t.Fatal("migration failure reported success")
	}
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	if got := schema(raw); !reflect.DeepEqual(got, before) {
		t.Fatal("failed migration left partial schema")
	}
	var count int
	if err = raw.QueryRow(`SELECT count(*) FROM schema_migrations`).Scan(&count); err != nil || count != 7 {
		t.Fatal("failed migration receipt persisted", count, err)
	}
	if _, err = raw.Exec(`DROP TRIGGER fail_telemetry_receipt`); err != nil {
		t.Fatal(err)
	}
	if err = raw.Close(); err != nil {
		t.Fatal(err)
	}
	recovered, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer recovered.Close()
	if got := schema(recovered.db); !reflect.DeepEqual(got, complete) {
		t.Fatal("retry did not restore complete schema and indexes")
	}
	if err = recovered.db.QueryRow(`SELECT count(*) FROM schema_migrations`).Scan(&count); err != nil || count != 9 {
		t.Fatal("retry missing receipts", count, err)
	}
}
