package storage

import (
	"context"
	"errors"
	"github.com/vioira/viorka/internal/monitoring"
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
