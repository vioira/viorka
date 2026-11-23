package storage

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/inventory"
)

func TestNodeAssetsPersistAndRestore(t *testing.T) {
	s := testStore(t)
	ctx := t.Context()
	start := time.Now().UTC().Truncate(time.Minute)
	if _, err := s.db.Exec(`INSERT INTO nodes (id,name,kind,state,created_at) VALUES ('n','node','nat','online',?)`, at(start)); err != nil {
		t.Fatal(err)
	}
	updateUptime := func(offset time.Duration, seconds float64, legacy, changed bool) {
		t.Helper()
		wrote, err := s.SaveNodeUptime(ctx, "n", seconds, start.Add(offset), legacy)
		if err != nil || wrote != changed {
			t.Fatalf("uptime %v: wrote %v, %v", offset, wrote, err)
		}
	}
	updateUptime(0, 999, true, true)
	updateUptime(9*time.Minute, 1200, true, false)
	updateUptime(10*time.Minute, 1400, true, true)
	updateUptime(10*time.Minute, 99999, false, false)
	updateUptime(time.Minute, 99999, false, false)
	updateUptime(11*time.Minute, 0, false, true)
	price, months := "900719925474099.17", 24
	expiry := start.Add(-time.Hour)
	update := inventory.BillingUpdate{ExpectedRevision: 1, Price: &price, Currency: "USD", PeriodMonths: &months, ExpiresAt: &expiry}
	if _, err := s.SaveNodeBilling(ctx, "missing-user", "n", update); err == nil {
		t.Fatal("billing survived audit failure")
	}
	b, err := s.SaveNodeBilling(ctx, "admin", "n", update)
	if err != nil || b.Revision != 2 || b.Price == nil || *b.Price != price {
		t.Fatal(b, err)
	}
	if _, err = s.SaveNodeBilling(ctx, "admin", "n", update); !errors.Is(err, auth.ErrConflict) {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(`UPDATE nodes SET uptime_sampled_at=NULL WHERE id='n'`); err == nil {
		t.Fatal("unpaired uptime stored")
	}
	if _, err = s.db.Exec(`UPDATE nodes SET currency=NULL WHERE id='n'`); err == nil {
		t.Fatal("incomplete fee stored")
	}
	var count int
	if err = s.db.QueryRow(`SELECT count(*) FROM audit_logs WHERE resource_id='n' AND action='node.billing.update'`).Scan(&count); err != nil || count != 1 {
		t.Fatal(count, err)
	}
	assertAssets := func(repo *Store) {
		t.Helper()
		detail, err := repo.Node(ctx, "n")
		if err != nil || detail.UptimeSeconds == nil || *detail.UptimeSeconds != 0 || detail.UptimeSampledAt == nil || *detail.UptimeSampledAt != at(start.Add(11*time.Minute)) || !reflect.DeepEqual(detail.Billing, b) {
			t.Fatal(detail, err)
		}
		list, err := repo.Nodes(ctx, 10, "")
		if err != nil || len(list) != 1 || !reflect.DeepEqual(detail, list[0]) {
			t.Fatal(list, err)
		}
	}
	assertAssets(s)
	snap := filepath.Join(t.TempDir(), "assets.db")
	if err = s.Backup(ctx, snap); err != nil {
		t.Fatal(err)
	}
	if err = ValidateSnapshot(ctx, snap); err != nil {
		t.Fatal(err)
	}
	if err = PrepareRestoredSnapshot(ctx, snap); err != nil {
		t.Fatal(err)
	}
	restored, err := Open(ctx, snap)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	assertAssets(restored)
	if s.postgres {
		if _, err = s.db.Exec(`UPDATE nodes SET rental_expires_at=NULL`); err != nil {
			t.Fatal(err)
		}
		if err = s.RestorePostgresSnapshot(ctx, snap); err != nil {
			t.Fatal(err)
		}
		assertAssets(s)
		down, err := os.ReadFile("../../migrations/postgres/0006_node_assets.down.sql")
		if err != nil {
			t.Fatal(err)
		}
		if _, err = s.db.Exec(string(down)); err != nil {
			t.Fatal(err)
		}
	}
}

func TestConcurrentNodeBillingEdits(t *testing.T) {
	s := testStore(t)
	ctx := t.Context()
	node, err := auth.NewAgents(s).CreateEnrollment(ctx, "admin", "node", "vps")
	if err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	done := make(chan error, 2)
	for _, amount := range []string{"0", "10.05"} {
		go func() {
			<-start
			months := 6
			_, err := s.SaveNodeBilling(ctx, "admin", node.ID, inventory.BillingUpdate{ExpectedRevision: 1, Price: &amount, Currency: "EUR", PeriodMonths: &months})
			done <- err
		}()
	}
	close(start)
	first, second := <-done, <-done
	if !(first == nil && errors.Is(second, auth.ErrConflict) || second == nil && errors.Is(first, auth.ErrConflict)) {
		t.Fatal(first, second)
	}
	n, err := s.Node(ctx, node.ID)
	if err != nil || n.Billing.Revision != 2 || n.Billing.Price == nil || (*n.Billing.Price != "0" && *n.Billing.Price != "10.05") {
		t.Fatal(n, err)
	}
}
