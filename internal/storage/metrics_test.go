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
	at := time.Now().UTC().Truncate(5 * time.Minute).Add(time.Minute)
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
	h, err := s.MetricHistory(ctx, "n", at.Add(-time.Minute), at.Add(3*time.Minute), 300)
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
		h, err := s.MetricHistory(ctx, "0", start, end, 900)
		if err != nil || len(h.Points) > 673 {
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
