package storage

import (
	"context"
	"database/sql"
	"errors"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/monitoring"
	"github.com/vioira/viorka/migrations"
	v1 "github.com/vioira/viorka/protocol/v1"
	"path/filepath"
	"testing"
	"time"
)

func TestDailyTrafficDurabilityAndConflict(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "daily.db")
	s, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { s.Close() }()
	metricNode(t, s, "n")
	start := time.Date(2026, 11, 13, 0, 0, 0, 0, time.UTC)
	d := v1.TelemetryDailyTraffic{DayStart: start, DayEnd: start.AddDate(0, 0, 1), RXBytes: "100", TXBytes: "200", SampledAt: start.Add(time.Hour), Revision: 1}
	save := func(d v1.TelemetryDailyTraffic) error {
		acks, err := s.SaveDailyTraffic(ctx, "n", []*v1.TelemetryDailyTraffic{&d})
		if err == nil && (len(acks) != 1 || acks[0].Revision != d.Revision) {
			t.Fatal("missing durable acknowledgement")
		}
		return err
	}
	if err = save(d); err != nil {
		t.Fatal(err)
	}
	d.Revision = 2
	d.RXBytes = "300"
	d.SampledAt = d.SampledAt.Add(time.Minute)
	if err = save(d); err != nil {
		t.Fatal(err)
	}
	if err = save(d); err != nil {
		t.Fatal(err)
	}
	stale := d
	stale.Revision = 1
	stale.RXBytes = "100"
	if err = save(stale); err != nil {
		t.Fatal(err)
	}
	conflict := d
	conflict.RXBytes = "400"
	if err = save(conflict); !errors.Is(err, monitoring.ErrDailyTrafficConflict) {
		t.Fatal(err)
	}
	conflict = d
	conflict.Revision++
	conflict.RXBytes = "200"
	if err = save(conflict); !errors.Is(err, monitoring.ErrDailyTrafficConflict) {
		t.Fatal(err)
	}
	// A later failure must roll back the earlier update and produce no acknowledgements.
	next := d
	next.Revision++
	next.RXBytes = "500"
	bad := d
	bad.DayStart = d.DayStart.Add(time.Hour)
	if acks, err := s.SaveDailyTraffic(ctx, "n", []*v1.TelemetryDailyTraffic{&next, &bad}); err == nil || acks != nil {
		t.Fatal("partial commit", acks, err)
	}
	backup := filepath.Join(t.TempDir(), "backup.db")
	if err = s.Backup(ctx, backup); err != nil {
		t.Fatal(err)
	}
	if err = ValidateSnapshot(ctx, backup); err != nil {
		t.Fatal(err)
	}
	s.Close()
	s, err = Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := s.DailyTraffic(ctx, "n", start, start.AddDate(0, 0, 1))
	if err != nil || len(rows) != 1 || rows[0].RXBytes != "300" || rows[0].Revision != 2 {
		t.Fatal(rows, err)
	}
	if err = s.RotateTelemetryHistory(ctx, start.AddDate(0, 1, 0)); err != nil {
		t.Fatal(err)
	}
	rows, err = s.DailyTraffic(ctx, "n", start, start.AddDate(0, 0, 1))
	if err != nil || len(rows) != 1 {
		t.Fatal("daily history rotated away", err)
	}
}

func TestDailyTrafficReenrollmentStartsIndependentLedger(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	agents := auth.NewAgents(s)
	e, err := agents.CreateEnrollment(ctx, "admin", "daily", "vps")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Enroll(ctx, auth.Hash(e.Token), "old-daily-key"); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	start := now.Truncate(24 * time.Hour)
	old := v1.TelemetryDailyTraffic{DayStart: start, DayEnd: start.Add(24 * time.Hour), SampledAt: now, RXBytes: "1342834751", TXBytes: "1313089455", Revision: 425, Quality: 2}
	save := func(d v1.TelemetryDailyTraffic) error {
		_, err := s.SaveDailyTraffic(ctx, e.ID, []*v1.TelemetryDailyTraffic{&d})
		return err
	}
	if err := save(old); err != nil {
		t.Fatal(err)
	}
	reset, err := agents.ResetEnrollment(ctx, "admin", e.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Enroll(ctx, auth.Hash(reset.Token), "new-daily-key"); err != nil {
		t.Fatal(err)
	}
	current := old
	current.RXBytes = "804501489"
	current.TXBytes = "806454481"
	current.Revision = 482
	current.Quality = 1
	if err := save(current); err != nil {
		t.Fatal("new registration blocked by old ledger:", err)
	}
	if err := save(current); err != nil {
		t.Fatal("duplicate:", err)
	}
	rows, err := s.DailyTraffic(ctx, e.ID, start, start.Add(24*time.Hour))
	if err != nil || len(rows) != 1 || rows[0].RXBytes != current.RXBytes || rows[0].Quality != 1 {
		t.Fatal(rows, err)
	}
	var count int
	if err := s.db.QueryRow(`SELECT count(*) FROM node_daily_traffic WHERE node_id=?`, e.ID).Scan(&count); err != nil || count != 2 {
		t.Fatal("old ledger not preserved", count, err)
	}
	overview, err := s.OverviewTraffic(ctx, 1, time.UTC, now)
	if err != nil || len(overview.Points) != 1 || (overview.Points[0].RX == nil || *overview.Points[0].RX != current.RXBytes) {
		t.Fatal("old and new ledgers counted together", overview, err)
	}
	regressed := current
	regressed.Revision++
	regressed.RXBytes = "1"
	if err := save(regressed); !errors.Is(err, monitoring.ErrDailyTrafficConflict) {
		t.Fatal("same registration regression accepted", err)
	}
	backup := filepath.Join(t.TempDir(), "generations.db")
	if err := s.Backup(ctx, backup); err != nil {
		t.Fatal(err)
	}
	if err := ValidateSnapshot(ctx, backup); err != nil {
		t.Fatal(err)
	}
	restored, err := Open(ctx, backup)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	rows, err = restored.DailyTraffic(ctx, e.ID, start, start.Add(24*time.Hour))
	if err != nil || len(rows) != 1 || rows[0].RXBytes != current.RXBytes {
		t.Fatal(rows, err)
	}
}

func TestDailyTrafficMigrationKeepsPreRegistrationRecords(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "previous.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	files, err := migrations.Files.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		if file.Name() >= "0022_daily_traffic_generations.up.sql" {
			continue
		}
		raw, _ := migrations.Files.ReadFile(file.Name())
		if _, err := db.Exec(string(raw)); err != nil {
			t.Fatal(file.Name(), err)
		}
	}
	if _, err := db.Exec(`INSERT INTO nodes(id,name,kind,created_at,enrollment_used_at) VALUES('old','old','vps','2026-11-16T00:00:00.000000000Z','2026-11-16T05:49:25.000000000Z'),('current','current','vps','2026-11-16T00:00:00.000000000Z','2026-11-16T01:00:00.000000000Z')`); err != nil {
		t.Fatal(err)
	}
	for _, node := range []string{"old", "current"} {
		if _, err := db.Exec(`INSERT INTO node_daily_traffic VALUES(?,1794787200000,1794873600000,1342834751,1313089455,1794800385287,425,2)`, node); err != nil {
			t.Fatal(err)
		}
	}
	raw, _ := migrations.Files.ReadFile("0022_daily_traffic_generations.up.sql")
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(string(raw)); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for node, want := range map[string]string{"old": "", "current": "2026-11-16T01:00:00.000000000Z"} {
		var registration string
		var rx int64
		if err := db.QueryRow(`SELECT registration_at,rx_bytes FROM node_daily_traffic WHERE node_id=?`, node).Scan(&registration, &rx); err != nil || registration != want || rx != 1342834751 {
			t.Fatal(node, registration, rx, err)
		}
	}
}
