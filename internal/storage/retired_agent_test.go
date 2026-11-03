package storage

import "testing"

func TestFreshSchemaOmitsRetiredAgentSettings(t *testing.T) {
	s := testStore(t)
	for _, column := range []string{"settings_revision", "collection_seconds", "report_seconds", "wss_report_seconds", "connection_mode", "settings_result_json"} {
		var count int
		if err := s.db.QueryRow("SELECT count(*) FROM pragma_table_info('nodes') WHERE name=?", column).Scan(&count); err != nil {
			t.Fatal(err)
		} else if count != 0 {
			t.Fatal("retired column initialized", column)
		}
	}
}
