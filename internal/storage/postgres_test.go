package storage

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/settings"
)

func TestPostgresPlaceholders(t *testing.T) {
	query := "SELECT ?, '?', \"?\", 'it''s ?', $$?$$, $body$?$body$, ? -- ?\n/* ? /* ? */ ? */ WHERE id=?"
	want := "SELECT $1, '?', \"?\", 'it''s ?', $$?$$, $body$?$body$, $2 -- ?\n/* ? /* ? */ ? */ WHERE id=$3"
	if got := postgresSQL(query); got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func openRepositoryTestStore(t *testing.T, path string) (*Store, error) {
	t.Helper()
	if os.Getenv("VIORKA_STORAGE_TEST_DRIVER") == "postgres" {
		return newPostgresTestStore(t, path), nil
	}
	return Open(context.Background(), path)
}

func newPostgresTestStore(t *testing.T, path string) *Store {
	t.Helper()
	raw := os.Getenv("VIORKA_TEST_POSTGRES")
	if raw == "" {
		t.Skip("VIORKA_TEST_POSTGRES is not set")
	}
	admin, err := sql.Open("pgx", raw)
	if err != nil {
		t.Fatal(err)
	}
	schema := "viorka_test_" + auth.Random()[:24]
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if _, err = admin.ExecContext(ctx, "CREATE SCHEMA "+quoteIdentifier(schema)); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, err := admin.ExecContext(ctx, "DROP SCHEMA "+quoteIdentifier(schema)+" CASCADE")
		if err != nil {
			t.Error(err)
		}
		admin.Close()
	})
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	s, err := OpenPostgres(ctx, u.String(), path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

// Run the existing business contracts against an isolated PostgreSQL schema
// per fixture. SQLite-only file lifecycle and trigger-injection tests retain
// their original coverage in the normal suite.
func TestPostgresRepositories(t *testing.T) {
	if os.Getenv("VIORKA_TEST_POSTGRES") == "" {
		t.Skip("VIORKA_TEST_POSTGRES is not set")
	}
	t.Setenv("VIORKA_STORAGE_TEST_DRIVER", "postgres")
	tests := []struct {
		name string
		run  func(*testing.T)
	}{
		{"enrollment", TestAtomicEnrollmentAndExpiry},
		{"task_leases", TestTaskLeaseAttemptFencingAndRecovery},
		{"expiry", TestExpiredCredentialsAndOfflineTaskExpiry},
		{"password_cas", TestPasswordCASInvalidatesSessionsAndRejectsStaleLogin},
		{"last_admin", TestConcurrentLastAdminProtection},
		{"offline_notifications", TestOfflineNotificationPreference},
		{"offline_alert_policy", TestOfflineAlertPolicyChanges},
		{"notification_rules", TestAlertIncidentAndOutbox},
		{"notification_template_upgrade", TestUpgradeSavedAlertTemplates},
		{"notification_delivery", TestAlertDeliveryRetriesAreIndependent},
		{"notification_snapshot", TestRestoreClearsAlertSecretsAndPendingPush},
		{"origin_migration", TestOriginConfirmationRequiresCurrentSessionAndTarget},
		{"offline_window", TestOfflineWindowAndRecovery},
		{"registration", TestBatchRegistrationAtomicQuotaAndIdentity},
		{"registration_concurrency", TestBatchConcurrentSameKeyAndRevocation},
		{"node_assets", TestNodeAssetsPersistAndRestore},
		{"node_assets_concurrency", TestConcurrentNodeBillingEdits},
		{"rename", TestRenameNodeCASAuditAndIdentity},
		{"draft_cas_ports", TestEngineDraftCASAndSharedPortReservations},
		{"engine_authorization", TestEngineAuthorizationAndAtomicSubmission},
		{"engine_publish", TestEnginePublicationVersions},
		{"engine_apply", TestEngineApplicationRetainsLaterDraftAndDeletion},
		{"engine_offline", TestEngineManualStopAndOffline},
		{"engine_rotation", TestEngineCredentialRotationCannotBeUndoneByRestore},
		{"engine_cipher", TestEngineCipherBindsResourceAndDetectsTampering},
		{"engine_uninstall", TestEngineUninstallServiceChoices},
		{"engine_diagnostics", TestEngineDependencyDiagnostic},
		{"engine_endpoint", TestPublicEndpointApplyDoesNotDispatch},
		{"engine_summaries", TestNodeEngineSummariesRespectGrantsAndInstallation},
		{"engine_configuration", TestEngineConfigurationReadIsScopedAndDoesNotApply},
		{"preset_sync", TestPresetSyncOfflineLatestAndOverrides},
		{"preset_inflight", TestPresetSyncInFlightAndStoppedIntent},
		{"preset_permissions", TestPresetConfirmationAndPermissions},
		{"preset_failures", TestPresetSyncConflictAndFailureAreNotSuccess},
		{"preset_concurrency", TestPresetConcurrentEditsHaveSingleWinner},
		{"outbound_references", TestOutboundEncryptionAndReferenceValidation},
		{"outbound_sync", TestOutboundSyncPreservesUnpublishedDraftAndCredentials},
		{"outbound_preset", TestOutboundRoutingSurvivesPresetUpdate},
		{"outbound_delete", TestOutboundDeletionWaitsForAppliedRemoval},
		{"outbound_concurrency", TestOutboundConcurrentUpdateSingleWinner},
		{"subscriptions", TestSubscriptionTokenRulesAndBoundedAccess},
		{"subscription_queries", TestSubscriptionSearchAndCandidateCursor},
		{"subscription_template_impact", TestSubscriptionTemplateImpactAndRestore},
		{"subscription_template_history", TestSubscriptionTemplateHistoryRetentionAndSnapshot},
		{"subscription_permissions", TestSubscriptionPermissionsAreRechecked},
		{"subscription_rules", TestSubscriptionSharedRuleRequiresCurrentImpactConfirmation},
		{"subscription_stopped", TestSubscriptionRetainsPublishedServicesWhenStopped},
		{"history_rotation", TestTelemetryWeekRotationForeignKeysAndLateArrival},
		{"history_late_uptime", TestLateSlowUptimePreservesCommittedHistory},
		{"history_clock", TestTelemetryMissedWeeksAndRollback},
		{"history_constraints", TestTelemetryConstraintsAndWholeNodeBudget},
		{"history_ranges", TestTelemetryHistoryTwoPartitionsRangeAndGaps},
	}
	for _, test := range tests {
		t.Run(test.name, test.run)
	}
}

func TestPostgresSnapshotAndSchema(t *testing.T) {
	t.Setenv("VIORKA_STORAGE_TEST_DRIVER", "postgres")
	s := engineFixture(t)
	ctx := context.Background()
	if err := s.InitSettings(ctx, "https://panel.example.com"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`INSERT INTO web_sessions VALUES('token','admin','csrf','2099-01-01T00:00:00Z'); INSERT INTO login_history(id,token_hash,user_id,method,source,user_agent,first_ip,latest_ip,created_at,last_active_at,expires_at) VALUES('login','token','admin','password','','','','','now','now','2099-01-01T00:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	encrypted, err := s.sealEngine("sing", []byte(`{"secret":"snapshot-secret"}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(`INSERT INTO engine_credentials(engine_id,encrypted) VALUES('sing',?); INSERT INTO subscriptions(id,owner_id,name,mihomo_port,created_at,updated_at) VALUES('sub','admin','backup',7890,'now','now'); INSERT INTO subscription_accesses(id,subscription_id,at,user_agent,rule_id,format,result) VALUES(100,'sub','now','','','mihomo','ok')`, encrypted); err != nil {
		t.Fatal(err)
	}
	backups, err := settings.NewBackups(s.localPath, s, ValidateSnapshot)
	if err != nil {
		t.Fatal(err)
	}
	record, err := backups.Create(ctx, "admin")
	if err != nil {
		t.Fatal(err)
	}
	if err = backups.PrepareRestore(ctx, "admin", record.ID); err != nil {
		t.Fatal(err)
	}
	snapshot := filepath.Join(t.TempDir(), "snapshot.db")
	if err := s.Backup(ctx, snapshot); err != nil {
		t.Fatal(err)
	}
	if err := s.Backup(ctx, snapshot); err == nil {
		t.Fatal("overwrote existing snapshot")
	}
	if err := ValidateSnapshot(ctx, snapshot); err != nil {
		t.Fatal(err)
	}
	if err := PrepareRestoredSnapshot(ctx, snapshot); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`UPDATE users SET username='changed' WHERE id='admin'`); err != nil {
		t.Fatal(err)
	}
	// Inject an import failure after TRUNCATE to verify the whole restore rolls back.
	if _, err := s.db.Exec(`CREATE FUNCTION reject_restore() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected restore failure'; END $$; CREATE TRIGGER reject_restore BEFORE INSERT ON nodes FOR EACH ROW EXECUTE FUNCTION reject_restore()`); err != nil {
		t.Fatal(err)
	}
	if err := backups.ApplyPendingDatabase(ctx, s.localPath, PrepareRestoredSnapshot, s.RestorePostgresSnapshot); err == nil {
		t.Fatal("expected restore failure")
	}
	if pending, err := backups.Pending(); err != nil || pending != record.ID {
		t.Fatalf("failed restore lost pending plan: %s %v", pending, err)
	}
	var unchanged string
	if err := s.db.QueryRow(`SELECT username FROM users WHERE id='admin'`).Scan(&unchanged); err != nil || unchanged != "changed" {
		t.Fatalf("failed restore changed database: %q %v", unchanged, err)
	}
	if _, err := s.db.Exec(`DROP TRIGGER reject_restore ON nodes; DROP FUNCTION reject_restore()`); err != nil {
		t.Fatal(err)
	}
	if err := backups.ApplyPendingDatabase(ctx, s.localPath, PrepareRestoredSnapshot, s.RestorePostgresSnapshot); err != nil {
		t.Fatal(err)
	}
	var name string
	var sessions int
	if err := s.db.QueryRow(`SELECT username FROM users WHERE id='admin'`).Scan(&name); err != nil || name != "admin" {
		t.Fatalf("restored username %q: %v", name, err)
	}
	if err := s.db.QueryRow(`SELECT count(*) FROM web_sessions`).Scan(&sessions); err != nil || sessions != 0 {
		t.Fatalf("restored sessions %d: %v", sessions, err)
	}
	var ended string
	if err := s.db.QueryRow(`SELECT end_reason FROM login_history WHERE id='login'`).Scan(&ended); err != nil || ended != "revoked" {
		t.Fatalf("session trigger %q: %v", ended, err)
	}
	if pending, err := backups.Pending(); err != nil || pending != "" {
		t.Fatalf("completed restore retained plan: %s %v", pending, err)
	}
	var restoredCipher string
	if err := s.db.QueryRow(`SELECT encrypted FROM engine_credentials WHERE engine_id='sing'`).Scan(&restoredCipher); err != nil {
		t.Fatal(err)
	}
	plaintext, err := s.openEngine("sing", restoredCipher)
	if err != nil || string(plaintext) != `{"secret":"snapshot-secret"}` {
		t.Fatalf("restored engine secret: %v", err)
	}
	var accessID int64
	if err := s.db.QueryRow(`INSERT INTO subscription_accesses(subscription_id,at,user_agent,rule_id,format,result) VALUES('sub','now','','','mihomo','ok') RETURNING id`).Scan(&accessID); err != nil || accessID != 101 {
		t.Fatalf("restored identity sequence: %d %v", accessID, err)
	}
	// Foreign keys and conflict classification must survive a restore.
	_, err = s.db.Exec(`INSERT INTO engine_credentials(engine_id,encrypted) VALUES('missing','invalid')`)
	if !errors.Is(constraint(err), auth.ErrConflict) {
		t.Fatalf("foreign key classification: %v", err)
	}
	if _, err = s.db.Exec(`UPDATE schema_migrations SET sha256='modified' WHERE version='0001_init.up.sql'`); err != nil {
		t.Fatal(err)
	}
	if err = s.migratePostgres(ctx); err == nil || !strings.Contains(err.Error(), "modified") {
		t.Fatalf("migration checksum: %v", err)
	}
}

func TestPostgresConnectionCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := OpenPostgres(ctx, "postgresql://panel:private-password@localhost/viorka", filepath.Join(t.TempDir(), "panel"))
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("lost cancellation: %v", err)
	}
	if strings.Contains(err.Error(), "private-password") {
		t.Fatal("connection error leaked password")
	}
}
