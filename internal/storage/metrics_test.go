package storage

import (
	"context"
	"errors"
	"fmt"
	"github.com/vioira/viorka/internal/monitoring"
	v1 "github.com/vioira/viorka/protocol/v1"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func metricNode(t testing.TB, s *Store, id string) {
	t.Helper()
	if _, err := s.db.Exec(`INSERT INTO nodes(id,name,kind,created_at) VALUES(?,?,'vps',?)`, id, id, now()); err != nil {
		t.Fatal(err)
	}
}
func metricSample(at time.Time, cpu float64) v1.NodeMetrics {
	return v1.NodeMetrics{SampledAt: at, CPU: &v1.CPUMetrics{LogicalCPUs: 1, UsagePercent: &cpu}, Errors: []string{"network_unavailable"}}
}
func TestMetricPersistenceRestartAndAggregation(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "metrics.db")
	s, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { s.Close() }()
	metricNode(t, s, "n")
	r, err := monitoring.NewRecorder(ctx, s)
	if err != nil {
		t.Fatal(err)
	}
	at := time.Now().UTC().Truncate(3 * time.Minute).Add(time.Minute)
	r.Observe("n", metricSample(at, 10), at, 30)
	r.Observe("n", metricSample(at, 99), at, 30)
	r.Observe("n", metricSample(at.Add(-time.Second), 90), at, 30)
	if err = r.Flush(ctx, at.Add(30*time.Second), false); err != nil {
		t.Fatal(err)
	}
	// Reopen the actual SQLite file and reconstruct the partial minute.
	s.Close()
	s, err = Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	r, err = monitoring.NewRecorder(ctx, s)
	if err != nil {
		t.Fatal(err)
	}
	r.Observe("n", metricSample(at.Add(10*time.Second), 30), at.Add(10*time.Second), 30)
	r.Observe("n", metricSample(at.Add(time.Minute), 80), at.Add(time.Minute), 30)
	for i := 0; i < 2; i++ {
		if err = r.Flush(ctx, at.Add(2*time.Minute), true); err != nil {
			t.Fatal(err)
		}
	}
	h, err := s.MetricHistory(ctx, "n", at.Add(-time.Minute), at.Add(3*time.Minute), 180)
	if err != nil {
		t.Fatal(err)
	}
	if len(h.Points) != 1 {
		t.Fatalf("%+v", h)
	}
	v := h.Points[0].Stats["cpu"]
	if v.Count != 3 || v.Sum != 120 || v.Max != 80 {
		t.Fatalf("lost or duplicated samples: %+v", v)
	}
	if _, ok := h.Points[0].Stats["rx"]; ok {
		t.Fatal("unknown network became zero")
	}
	// An older retry cannot replace a newer bucket.
	if err = s.SaveRollups(ctx, []monitoring.Rollup{{Node: "n", At: at, LastSample: at, Stats: map[string]monitoring.Statistic{"cpu": {Sum: 99, Max: 99, Count: 1}}}}); err != nil {
		t.Fatal(err)
	}
	h, _ = s.MetricHistory(ctx, "n", at.Add(-time.Minute), at.Add(3*time.Minute), 60)
	if h.Points[0].Stats["cpu"].Sum != 40 {
		t.Fatal("late overwrite")
	}
}

type failingMetrics struct {
	*Store
	fail bool
}

func (s *failingMetrics) SaveRollups(ctx context.Context, rows []monitoring.Rollup) error {
	if s.fail {
		return errors.New("disk unavailable")
	}
	return s.Store.SaveRollups(ctx, rows)
}
func TestMetricWriteFailureAndRetention(t *testing.T) {
	s := testStore(t)
	metricNode(t, s, "n")
	ctx := context.Background()
	repo := &failingMetrics{s, true}
	r, err := monitoring.NewRecorder(ctx, repo)
	if err != nil {
		t.Fatal(err)
	}
	at := time.Now().UTC().Truncate(time.Minute)
	r.Observe("n", metricSample(at, 10), at, 30)
	if r.Flush(ctx, at.Add(30*time.Second), false) == nil {
		t.Fatal("write failure swallowed")
	}
	r.Observe("n", metricSample(at.Add(time.Second), 20), at.Add(time.Second), 30)
	repo.fail = false
	if err = r.Flush(ctx, at.Add(36*time.Second), false); err != nil {
		t.Fatal(err)
	}
	h, _ := s.MetricHistory(ctx, "n", at.Add(-time.Second), at.Add(time.Minute), 60)
	if len(h.Points) != 1 || h.Points[0].Stats["cpu"].Count != 2 {
		t.Fatalf("retry lost samples %+v", h)
	}
	old := monitoring.Rollup{Node: "n", At: at.Add(-8 * 24 * time.Hour), LastSample: at, Stats: map[string]monitoring.Statistic{}}
	if err = s.SaveRollups(ctx, []monitoring.Rollup{old}); err != nil {
		t.Fatal(err)
	}
	if err = s.PruneMetrics(ctx, at.Add(-7*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	var count int
	s.db.QueryRow(`SELECT count(*) FROM metric_rollups`).Scan(&count)
	if count != 1 {
		t.Fatal(count)
	}
	// A removed node cannot poison the entire next batch through an FK failure.
	if _, err = s.db.Exec(`DELETE FROM nodes WHERE id='n'`); err != nil {
		t.Fatal(err)
	}
	if err = s.SaveRollups(ctx, []monitoring.Rollup{old}); err != nil {
		t.Fatal(err)
	}
}
func BenchmarkMetricHistory50Nodes7Days(b *testing.B) {
	ctx := context.Background()
	s, err := Open(ctx, filepath.Join(b.TempDir(), "metrics.db"))
	if err != nil {
		b.Fatal(err)
	}
	defer s.Close()
	end := time.Now().UTC().Truncate(time.Minute)
	start := end.Add(-7 * 24 * time.Hour)
	for n := 0; n < 50; n++ {
		id := fmt.Sprint(n)
		metricNode(b, s, id)
		batch := []monitoring.Rollup{}
		for at := start; at.Before(end); at = at.Add(time.Minute) {
			batch = append(batch, monitoring.Rollup{Node: id, At: at, LastSample: at, Stats: map[string]monitoring.Statistic{"cpu": {Sum: 1500, Max: 80, Count: 30}, "memory": {Sum: 1200, Max: 60, Count: 30}, "rx": {Sum: 3e6, Max: 2e5, Count: 30}, "tx": {Sum: 6e6, Max: 3e5, Count: 30}}})
			if len(batch) == 512 {
				if err = s.SaveRollups(ctx, batch); err != nil {
					b.Fatal(err)
				}
				batch = nil
			}
		}
		if err = s.SaveRollups(ctx, batch); err != nil {
			b.Fatal(err)
		}
	}
	var count int
	s.db.QueryRow(`SELECT count(*) FROM metric_rollups`).Scan(&count)
	if count != 504000 {
		b.Fatal(count)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		h, err := s.MetricHistory(ctx, "0", start, end, 3600)
		if err != nil || len(h.Points) > 169 {
			b.Fatal(err, len(h.Points))
		}
	}
}

func TestMetricSettingsUpgradeFromV5(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "upgrade.db")
	s, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	down, err := os.ReadFile("../../migrations/0006_metric_history.down.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(string(down)); err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(`DELETE FROM schema_migrations WHERE version='0006_metric_history.up.sql'`); err != nil {
		t.Fatal(err)
	}
	metricNode(t, s, "preserved")
	if _, err = s.db.Exec(`UPDATE nodes SET collection_seconds=20,report_seconds=600,wss_report_seconds=40,inventory_json='{}' WHERE id='preserved'`); err != nil {
		t.Fatal(err)
	}
	s.Close()
	s, err = Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	settings, err := s.NodeSettings(ctx, "preserved")
	if err != nil || settings.CollectionSeconds != 0 || settings.ReportSeconds != 60 || settings.WssReportSeconds != 2 || settings.Revision != 2 {
		t.Fatalf("migration settings %+v %v", settings, err)
	}
	var inventory string
	if err = s.db.QueryRow(`SELECT inventory_json FROM nodes WHERE id='preserved'`).Scan(&inventory); err != nil || inventory != "{}" {
		t.Fatal("asset lost", err)
	}
	backups, err := filepath.Glob(path + ".before-*.bak")
	if err != nil || len(backups) == 0 {
		t.Fatal("upgrade backup missing")
	}
	for _, sql := range []string{`UPDATE nodes SET collection_seconds=11`, `UPDATE nodes SET report_seconds=29`, `UPDATE nodes SET report_seconds=181`, `UPDATE nodes SET wss_report_seconds=0`, `UPDATE nodes SET wss_report_seconds=6`} {
		if _, err = s.db.Exec(sql); err == nil {
			t.Fatal("database accepted invalid settings", sql)
		}
	}
	if _, err = s.db.Exec(`UPDATE nodes SET collection_seconds=10,wss_report_seconds=1`); err != nil {
		t.Fatal("independent clocks rejected", err)
	}
}

func TestHistoryResolutionBuckets(t *testing.T) {
	s := testStore(t)
	metricNode(t, s, "n")
	ctx := context.Background()
	start := time.Date(2026, 10, 31, 0, 0, 0, 0, time.UTC)
	rows := []monitoring.Rollup{}
	for i := 0; i < 60; i++ {
		at := start.Add(time.Duration(i) * time.Minute)
		rows = append(rows, monitoring.Rollup{Node: "n", At: at, LastSample: at, Stats: map[string]monitoring.Statistic{"cpu": {Sum: float64(i), Max: float64(i), Count: 1}}})
	}
	if err := s.SaveRollups(ctx, rows); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ period, count int }{{60, 60}, {180, 20}, {720, 5}, {1440, 3}, {3600, 1}} {
		got, err := s.MetricHistory(ctx, "n", start, start.Add(time.Hour), tc.period)
		if err != nil || len(got.Points) != tc.count {
			t.Fatalf("period %d: %d %v", tc.period, len(got.Points), err)
		}
		var sum float64
		var count uint64
		for _, p := range got.Points {
			if p.At.Unix()%int64(tc.period) != 0 {
				t.Fatal("misaligned bucket")
			}
			sum += p.Stats["cpu"].Sum
			count += p.Stats["cpu"].Count
		}
		if sum != 1770 || count != 60 {
			t.Fatalf("lost samples: %f %d", sum, count)
		}
	}
}

func TestHalfMinuteHistoryAndLegacyRestart(t *testing.T) {
	s := testStore(t)
	metricNode(t, s, "n")
	ctx := context.Background()
	at := time.Now().UTC().Truncate(time.Minute)
	// Existing minutes survive upgrades without being split or double-counted.
	legacy := monitoring.Rollup{Node: "n", At: at, LastSample: at, PeriodSeconds: 60, Stats: map[string]monitoring.Statistic{"cpu": {Sum: 10, Max: 10, Count: 1}}}
	if err := s.SaveRollups(ctx, []monitoring.Rollup{legacy}); err != nil {
		t.Fatal(err)
	}
	r, err := monitoring.NewRecorder(ctx, s)
	if err != nil {
		t.Fatal(err)
	}
	for i, value := range []float64{20, 30, 90} {
		ts := at.Add(time.Duration(i+1) * 30 * time.Second)
		r.Observe("n", metricSample(ts, value), ts, 30)
	}
	if err := r.Flush(ctx, at.Add(2*time.Minute), true); err != nil {
		t.Fatal(err)
	}
	h, err := s.MetricHistory(ctx, "n", at, at.Add(2*time.Minute), 30)
	if err != nil || h.PeriodSeconds != 60 || len(h.Points) != 2 {
		t.Fatalf("legacy: %+v %v", h, err)
	}
	if v := h.Points[0].Stats["cpu"]; v.Sum != 30 || v.Count != 2 {
		t.Fatalf("legacy overlap: %+v", v)
	}
	h, err = s.MetricHistory(ctx, "n", at.Add(time.Minute), at.Add(2*time.Minute), 30)
	if err != nil || h.PeriodSeconds != 30 || len(h.Points) != 2 {
		t.Fatalf("half minutes: %+v %v", h, err)
	}
	if h.Points[0].Stats["cpu"].Max != 30 || h.Points[1].Stats["cpu"].Max != 90 {
		t.Fatal("lost peak")
	}
	// Restart and append to the second half; preserve the first half and its count.
	r, err = monitoring.NewRecorder(ctx, s)
	if err != nil {
		t.Fatal(err)
	}
	ts := at.Add(95 * time.Second)
	r.Observe("n", metricSample(ts, 10), ts, 30)
	if err := r.Flush(ctx, ts, true); err != nil {
		t.Fatal(err)
	}
	h, err = s.MetricHistory(ctx, "n", at.Add(time.Minute), at.Add(2*time.Minute), 30)
	if err != nil {
		t.Fatal(err)
	}
	if v := h.Points[1].Stats["cpu"]; v.Sum != 100 || v.Count != 2 || v.Max != 90 {
		t.Fatalf("restart: %+v", v)
	}
}

func TestRemoveLegacyMetricColumnsPreservesHistory(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "remove-legacy.db")
	s, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	metricNode(t, s, "n")
	// Reconstruct the previous schema with legacy values alongside real statistics.
	down, err := os.ReadFile("../../migrations/0009_remove_legacy_metric_columns.down.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(string(down)); err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(`DELETE FROM schema_migrations WHERE version='0009_remove_legacy_metric_columns.up.sql'`); err != nil {
		t.Fatal(err)
	}
	at := time.Now().UTC().Truncate(time.Minute)
	row := monitoring.Rollup{Node: "n", At: at, LastSample: at, Stats: map[string]monitoring.Statistic{"cpu": {Sum: 40, Max: 30, Count: 2}}}
	if err = s.SaveRollups(ctx, []monitoring.Rollup{row}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(`UPDATE metric_rollups SET cpu_avg=20,memory_used_bytes=100,rx_bytes=200,tx_bytes=300`); err != nil {
		t.Fatal(err)
	}
	s.Close()
	s, err = Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	var columns int
	if err = s.db.QueryRow(`SELECT count(*) FROM pragma_table_info('metric_rollups') WHERE name IN ('cpu_avg','memory_used_bytes','rx_bytes','tx_bytes')`).Scan(&columns); err != nil || columns != 0 {
		t.Fatal("legacy columns remain", columns, err)
	}
	history, err := s.MetricHistory(ctx, "n", at, at.Add(time.Minute), 30)
	if err != nil || len(history.Points) != 1 || history.Points[0].Stats["cpu"] != row.Stats["cpu"] {
		t.Fatalf("history changed: %+v %v", history, err)
	}
	backups, err := filepath.Glob(path + ".before-*.bak")
	if err != nil || len(backups) != 1 {
		t.Fatal("migration backup missing", err)
	}
	// Remaining foreign keys still cascade and no orphaned statistics survive deletion.
	if _, err = s.db.Exec(`DELETE FROM nodes WHERE id='n'`); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = s.db.QueryRow(`SELECT count(*) FROM metric_rollups`).Scan(&count); err != nil || count != 0 {
		t.Fatal("cascade broken", err)
	}
}
