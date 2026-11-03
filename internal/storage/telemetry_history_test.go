package storage

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/vioira/viorka/internal/monitoring"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func testValue[T any](v T) *T { return &v }
func historyFixture(node string, at time.Time, sequence uint64) monitoring.NodeHistory {
	b := monitoring.NewBucket(node, at)
	_ = b.AddFast(&v1.TelemetryFast{Sequence: sequence, SampledAt: at, CPUPercent: testValue(20.0), FilterRevision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", Errors: []string{"network_unavailable"}})
	_ = b.AddFull(&v1.TelemetryFull{Sequence: sequence, SampledAt: at, DiskIo: &v1.TelemetryDiskIO{ReadBytesPerSecond: testValue(12.0)}, Filesystems: []*v1.TelemetryFilesystem{{Identity: "8:0", MountPoint: "/", FilesystemType: "ext4", TotalBytes: 1000, UsedBytes: 300, AvailableBytes: 600}}})
	return monitoring.NodeHistory{Node: node, Buckets: []monitoring.Bucket{b}, Checkpoints: []monitoring.Checkpoint{{RunID: "run-1", Group: "fast", Sequence: sequence, SampledAt: at.UnixMilli()}, {RunID: "run-1", Group: "full", Sequence: sequence, SampledAt: at.UnixMilli()}}, System: &monitoring.SystemSnapshot{OSID: "debian", SampledAt: at.UnixMilli()}, Addresses: []monitoring.AddressSnapshot{{Family: 4, Address: "203.0.113.1", SampledAt: at.UnixMilli()}, {Family: 6, Unavailable: true, SampledAt: at.UnixMilli()}}}
}
func TestTelemetryAtomicSnapshotRestart(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "history.db")
	s, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { s.Close() }()
	metricNode(t, s, "n")
	at := time.Date(2026, 11, 2, 0, 0, 0, 0, time.UTC)
	n := historyFixture("n", at, 1)
	if err = s.SaveTelemetryHistory(ctx, []monitoring.NodeHistory{n}, at); err != nil {
		t.Fatal(err)
	}
	// Absolute retries do not double counts or duplicate device rows.
	if err = s.SaveTelemetryHistory(ctx, []monitoring.NodeHistory{n}, at); err != nil {
		t.Fatal(err)
	}
	s.Close()
	s, err = Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	restored, err := s.RestoreTelemetryHistory(ctx, at.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if len(restored) != 1 || len(restored[0].Buckets) != 1 || len(restored[0].Checkpoints) != 2 || restored[0].System.OSID != "debian" || len(restored[0].Addresses) != 2 {
		t.Fatalf("incomplete restore: %+v", restored)
	}
	b := restored[0].Buckets[0]
	if b.CPU.Count != 1 || *b.CPU.Sum != 20 || b.NetInSpeed.Max != nil || b.DiskIO.ReadSpeed.Count != 1 || len(b.Filesystems) != 1 || *b.DiskIO.ReadSpeed.Max != 12 {
		t.Fatalf("invalid roundtrip: %+v", b)
	}
	// Inject a real SQLite failure after a bucket write. The checkpoint and all
	// earlier rows in the same node transaction must roll back together.
	if _, err = s.db.Exec(`CREATE TRIGGER reject_checkpoint BEFORE UPDATE ON metric_ingest_checkpoints BEGIN SELECT RAISE(ABORT,'disk failure fixture'); END`); err != nil {
		t.Fatal(err)
	}
	n = historyFixture("n", at, 2)
	n.Buckets[0].CPU.Sum = testValue(99.0)
	if s.SaveTelemetryHistory(ctx, []monitoring.NodeHistory{n}, at) == nil {
		t.Fatal("failure swallowed")
	}
	restored, err = s.RestoreTelemetryHistory(ctx, at)
	if err != nil {
		t.Fatal(err)
	}
	if *restored[0].Buckets[0].CPU.Sum != 20 || restored[0].Checkpoints[0].Sequence != 1 {
		t.Fatal("partial snapshot committed")
	}
	if _, err = s.db.Exec(`DROP TRIGGER reject_checkpoint`); err != nil {
		t.Fatal(err)
	}
	if err = s.SaveTelemetryHistory(ctx, []monitoring.NodeHistory{n}, at); err != nil {
		t.Fatal(err)
	}
	old := historyFixture("n", at, 1)
	if !errors.Is(s.SaveTelemetryHistory(ctx, []monitoring.NodeHistory{old}, at), ErrStaleHistorySnapshot) {
		t.Fatal("checkpoint regressed")
	}
}
func TestTelemetryWeekRotationForeignKeysAndLateArrival(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	metricNode(t, s, "n")
	sunday := time.Date(2026, 11, 8, 0, 0, 0, 0, time.UTC)
	before := sunday.Add(-30 * time.Second)
	if err := s.SaveTelemetryHistory(ctx, []monitoring.NodeHistory{historyFixture("n", before, 1)}, before); err != nil {
		t.Fatal(err)
	}
	if err := s.RotateTelemetryHistory(ctx, sunday); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := s.db.QueryRow(`SELECT count(*) FROM metrics_history_old`).Scan(&count); err != nil || count != 1 {
		t.Fatal("lost previous week", count, err)
	}
	if err := s.db.QueryRow(`SELECT count(*) FROM metrics_history_old WHERE disk_read_speed_count > 0`).Scan(&count); err != nil || count != 1 {
		t.Fatal("lost device", count, err)
	}
	if err := s.SaveTelemetryHistory(ctx, []monitoring.NodeHistory{historyFixture("n", sunday, 2)}, sunday); err != nil {
		t.Fatal(err)
	}
	// Higher sequence with an older wall time routes by the observation bucket.
	if err := s.SaveTelemetryHistory(ctx, []monitoring.NodeHistory{historyFixture("n", before, 3)}, sunday); err != nil {
		t.Fatal(err)
	}
	h, err := s.TelemetryHistory(ctx, "n", before, sunday.Add(30*time.Second), sunday, 30)
	if err != nil || len(h) != 2 || len(h[0].Filesystems) != 1 || h[1].DiskIO.ReadSpeed.Count != 1 {
		t.Fatalf("cross-week %+v %v", h, err)
	}
	// A second rename verifies index names and foreign keys survive repeated cycles.
	if err = s.RotateTelemetryHistory(ctx, sunday.AddDate(0, 0, 7)); err != nil {
		t.Fatal(err)
	}
	if err = s.db.QueryRow(`SELECT count(*) FROM metrics_history_old`).Scan(&count); err != nil || count != 1 {
		t.Fatal(count, err)
	}
	if err = s.db.QueryRow(`SELECT count(*) FROM pragma_foreign_key_check`).Scan(&count); err != nil || count != 0 {
		t.Fatal("FK corruption", count, err)
	}
	if _, err = s.db.Exec(`DELETE FROM nodes WHERE id='n'`); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"metrics_history", "metrics_history_old", "metrics_filesystems_old", "metric_ingest_checkpoints", "node_system_info", "node_public_addresses"} {
		if err = s.db.QueryRow(`SELECT count(*) FROM ` + table).Scan(&count); err != nil || count != 0 {
			t.Fatal("cascade", table, count, err)
		}
	}
	if err = s.SaveTelemetryHistory(ctx, []monitoring.NodeHistory{historyFixture("n", sunday, 4)}, sunday.AddDate(0, 0, 7)); err != nil {
		t.Fatal("deleted node poisoned flush", err)
	}
	if err = s.db.QueryRow(`SELECT count(*) FROM metrics_history_old`).Scan(&count); err != nil || count != 0 {
		t.Fatal("resurrection", count, err)
	}
}
func TestTelemetryMissedWeeksAndRollback(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	metricNode(t, s, "n")
	at := time.Date(2026, 11, 2, 0, 0, 0, 0, time.UTC)
	if err := s.SaveTelemetryHistory(ctx, []monitoring.NodeHistory{historyFixture("n", at, 1)}, at); err != nil {
		t.Fatal(err)
	}
	if err := s.RotateTelemetryHistory(ctx, at.AddDate(0, 0, 15)); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"metrics_history", "metrics_history_old", "metrics_filesystems"} {
		var count int
		if err := s.db.QueryRow(`SELECT count(*) FROM ` + table).Scan(&count); err != nil || count != 0 {
			t.Fatal(table, count, err)
		}
	}
	if err := s.RotateTelemetryHistory(ctx, at); !errors.Is(err, ErrHistoryClockRollback) {
		t.Fatal("clock rollback not detected", err)
	}
	var week int64
	if err := s.db.QueryRow(`SELECT week_start FROM metric_history_partitions WHERE role='current'`).Scan(&week); err != nil || week != historyWeek(at.AddDate(0, 0, 15)) {
		t.Fatal("partition rewound", week, err)
	}
	if err := s.SaveTelemetryHistory(ctx, []monitoring.NodeHistory{historyFixture("n", at, 2)}, at); !errors.Is(err, ErrHistoryOutsidePartitions) {
		t.Fatal("old data relabeled", err)
	}
}
func TestTelemetryHistoryWeightedMeansAndSlowOnly(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	metricNode(t, s, "n")
	at := time.Date(2026, 11, 2, 0, 0, 0, 0, time.UTC)
	first := historyFixture("n", at, 1)
	first.Buckets[0].CPU = monitoring.Mean{Sum: testValue(300.0), Count: 30}
	first.Buckets[0].FastCount = 30
	second := historyFixture("n", at.Add(30*time.Second), 2)
	second.Buckets[0].CPU = monitoring.Mean{Sum: testValue(90.0), Count: 1}
	third := monitoring.NewBucket("n", at.Add(time.Minute))
	_ = third.AddFull(&v1.TelemetryFull{Sequence: 3, SampledAt: at.Add(time.Minute), Load1: testValue(1.5)})
	second.Buckets = append(first.Buckets, second.Buckets[0], third)
	if err := s.SaveTelemetryHistory(ctx, []monitoring.NodeHistory{second}, at.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	h, err := s.TelemetryHistory(ctx, "n", at, at.Add(90*time.Second), at.Add(time.Minute), 30)
	if err != nil || len(h) != 3 {
		t.Fatal(h, err)
	}
	if h[2].FastCount != 0 || h[2].CPU.Sum != nil || h[2].NetInSpeed.Max != nil || h[2].FullCount != 1 {
		t.Fatal("slow-only filled fast", h[2])
	}
	h, err = s.TelemetryHistory(ctx, "n", at, at.Add(90*time.Second), at.Add(time.Minute), 180)
	if err != nil || len(h) != 1 || h[0].CPU.Count != 31 || *h[0].CPU.Sum != 390 || *h[0].Load1 != 1.5 {
		t.Fatal("incorrect merge", h, err)
	}
	if _, err = s.TelemetryHistory(ctx, "n", at.Add(-169*time.Hour), at, at, 30); err == nil {
		t.Fatal("oversized query")
	}
}
func TestTelemetryConstraintsAndWholeNodeBudget(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	metricNode(t, s, "n")
	at := time.Date(2026, 11, 2, 0, 0, 0, 0, time.UTC)
	n := historyFixture("n", at, 1)
	n.Buckets[0].Start++
	if s.SaveTelemetryHistory(ctx, []monitoring.NodeHistory{n}, at) == nil {
		t.Fatal("unaligned bucket")
	}
	n = historyFixture("n", at, 1)
	n.Buckets[0].CPU.Sum = nil
	if s.SaveTelemetryHistory(ctx, []monitoring.NodeHistory{n}, at) == nil {
		t.Fatal("count/null invariant")
	}
	n = historyFixture("n", at, 1)
	n.Buckets[0].DiskIO.ReadSpeed.Count = n.Buckets[0].FullCount + 1
	if s.SaveTelemetryHistory(ctx, []monitoring.NodeHistory{n}, at) == nil {
		t.Fatal("disk count exceeds full samples")
	}
	n = historyFixture("n", at, 1)
	for i := 1; i <= 512; i++ {
		b := n.Buckets[0]
		b.Start += int64(i * 30)
		b.LastSample = b.Start * 1000
		n.Buckets = append(n.Buckets, b)
	}
	if s.SaveTelemetryHistory(ctx, []monitoring.NodeHistory{n}, at) == nil {
		t.Fatal("split or oversized node accepted")
	}
	var count int
	if err := s.db.QueryRow(`SELECT count(*) FROM metric_ingest_checkpoints`).Scan(&count); err != nil || count != 0 {
		t.Fatal("failed node advanced checkpoint", count, err)
	}
}

const telemetryTestRun = "11111111-1111-4111-8111-111111111111"

func telemetryBatchFixture(at time.Time, seq uint64) v1.TelemetryBatch {
	return v1.TelemetryBatch{NodeID: "n", RunID: telemetryTestRun, BatchID: "batch-1", Fast: []*v1.TelemetryFast{{Sequence: seq, SampledAt: at, CPUPercent: testValue(20.0), RamTotal: testValue(uint64(1000)), RamUsed: testValue(uint64(300)), FilterRevision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", Errors: []string{"network_unavailable"}}}, Full: []*v1.TelemetryFull{}, PublicIp: []*v1.TelemetryPublicIP{}}
}
func TestTelemetryRecorderReplayRestartAndGroupIdentity(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	metricNode(t, s, "n")
	at := time.Date(2026, 11, 2, 0, 0, 0, 0, time.UTC)
	r, err := monitoring.NewTelemetryRecorder(ctx, s, at)
	if err != nil {
		t.Fatal(err)
	}
	if err = r.BindRun("n", telemetryTestRun, at); err != nil {
		t.Fatal(err)
	}
	b := telemetryBatchFixture(at, 1)
	b.Full = append(b.Full, &v1.TelemetryFull{Sequence: 1, SampledAt: at, Load1: testValue(2.0), Errors: []string{"disk_unavailable"}})
	receipt, err := r.Accept(b, at, 60)
	if err != nil || receipt.AcceptedCount != 2 {
		t.Fatal(receipt, err)
	}
	// No borrowed mutable numeric pointers may leak into history ownership.
	*b.Fast[0].RamTotal = 9999
	if err = r.Flush(ctx, at, false); err != nil {
		t.Fatal(err)
	}
	r, err = monitoring.NewTelemetryRecorder(ctx, s, at)
	if err != nil {
		t.Fatal(err)
	}
	if err = r.BindRun("n", telemetryTestRun, at); err != nil {
		t.Fatal(err)
	}
	receipt, err = r.Accept(b, at, 60)
	if err != nil || receipt.AcceptedCount != 0 || receipt.DuplicateCount != 2 {
		t.Fatal("restart replay", receipt, err)
	}
	b.Fast = telemetryBatchFixture(at.Add(30*time.Second), 2).Fast
	receipt, err = r.Accept(b, at.Add(30*time.Second), 60)
	if err != nil || receipt.AcceptedCount != 1 || receipt.DuplicateCount != 1 {
		t.Fatal("full cache counted", receipt, err)
	}
	if err = r.Flush(ctx, at.Add(30*time.Second), true); err != nil {
		t.Fatal(err)
	}
	h, err := s.TelemetryHistory(ctx, "n", at, at.Add(time.Minute), at.Add(time.Minute), 30)
	if err != nil || len(h) != 2 {
		t.Fatal(h, err)
	}
	if *h[0].RAMTotal != 1000 || h[0].FullCount != 1 || h[1].FullCount != 0 || h[1].Load1 != nil {
		t.Fatal("ownership or slow timestamp lost", h)
	}
	otherRun := "22222222-2222-4222-8222-222222222222"
	if err = r.BindRun("n", otherRun, at); err != nil {
		t.Fatal(err)
	}
	if _, err = r.Accept(b, at.Add(time.Minute), 60); !errors.Is(err, monitoring.ErrTelemetryRun) {
		t.Fatal("superseded run accepted", err)
	}
}

type observingTelemetryRepo struct {
	*Store
	beforeSave func()
	fail       bool
}

func (s *observingTelemetryRepo) SaveTelemetryHistory(ctx context.Context, n []monitoring.NodeHistory, at time.Time) error {
	if s.beforeSave != nil {
		fn := s.beforeSave
		s.beforeSave = nil
		fn()
	}
	if s.fail {
		return errors.New("write failure")
	}
	return s.Store.SaveTelemetryHistory(ctx, n, at)
}
func TestTelemetryRecorderConcurrentMutationDuringCommit(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	metricNode(t, s, "n")
	at := time.Date(2026, 11, 2, 0, 0, 0, 0, time.UTC)
	repo := &observingTelemetryRepo{Store: s}
	r, err := monitoring.NewTelemetryRecorder(ctx, repo, at)
	if err != nil {
		t.Fatal(err)
	}
	if err = r.BindRun("n", telemetryTestRun, at); err != nil {
		t.Fatal(err)
	}
	if _, err = r.Accept(telemetryBatchFixture(at, 1), at, 60); err != nil {
		t.Fatal(err)
	}
	repo.beforeSave = func() {
		if _, err := r.Accept(telemetryBatchFixture(at.Add(time.Second), 2), at.Add(time.Second), 60); err != nil {
			t.Fatal(err)
		}
	}
	if err = r.Flush(ctx, at, false); err != nil {
		t.Fatal(err)
	}
	if err = r.Flush(ctx, at.Add(5*time.Second), false); err != nil {
		t.Fatal(err)
	}
	h, err := s.TelemetryHistory(ctx, "n", at, at.Add(30*time.Second), at.Add(5*time.Second), 30)
	if err != nil || len(h) != 1 || h[0].CPU.Count != 2 {
		t.Fatal("dirty version lost", h, err)
	}
	repo.fail = true
	if _, err = r.Accept(telemetryBatchFixture(at.Add(2*time.Second), 3), at.Add(2*time.Second), 60); err != nil {
		t.Fatal(err)
	}
	if r.Flush(ctx, at.Add(10*time.Second), false) == nil {
		t.Fatal("failure swallowed")
	}
	repo.fail = false
	if err = r.Flush(ctx, at.Add(11*time.Second), false); err != nil {
		t.Fatal(err)
	}
	saved, err := s.RestoreTelemetryHistory(ctx, at)
	if err != nil || saved[0].Checkpoints[0].Sequence != 2 {
		t.Fatal("retry ignored backoff", saved, err)
	}
	if err = r.Flush(ctx, at.Add(15*time.Second), false); err != nil {
		t.Fatal(err)
	}
	saved, err = s.RestoreTelemetryHistory(ctx, at)
	if err != nil || saved[0].Checkpoints[0].Sequence != 3 || saved[0].Buckets[0].CPU.Count != 3 {
		t.Fatal("retry lost data", saved, err)
	}
}

func TestTelemetryRecorderPersistedBucketsSurviveCacheExpiry(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	metricNode(t, s, "n")
	at := time.Date(2026, 11, 2, 0, 0, 0, 0, time.UTC)
	r, err := monitoring.NewTelemetryRecorder(ctx, s, at)
	if err != nil {
		t.Fatal(err)
	}
	if err = r.BindRun("n", telemetryTestRun, at); err != nil {
		t.Fatal(err)
	}
	// Cross the ten-minute in-memory horizon while a new sample dirties the node
	// before every flush, matching the continuous real-process soak workload.
	for i := 0; i < 24; i++ {
		now := at.Add(time.Duration(i) * 30 * time.Second)
		if _, err = r.Accept(telemetryBatchFixture(now, uint64(i+1)), now, 60); err != nil {
			t.Fatal(err)
		}
		if err = r.Flush(ctx, now.Add(5*time.Second), false); err != nil {
			t.Fatal(err)
		}
	}
	rows, err := s.TelemetryHistory(ctx, "n", at, at.Add(12*time.Minute), at.Add(12*time.Minute), 30)
	if err != nil || len(rows) != 24 {
		t.Fatalf("persisted buckets lost on expiry: rows=%d err=%v", len(rows), err)
	}
	for i, b := range rows {
		if b.Start != at.Add(time.Duration(i)*30*time.Second).Unix() || b.CPU.Count != 1 {
			t.Fatalf("wrong persisted bucket: %+v", b)
		}
	}
	// Restore and replay the final observation: the durable checkpoint remains
	// consistent with retained history even though early buckets left the cache.
	r, err = monitoring.NewTelemetryRecorder(ctx, s, at.Add(12*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if err = r.BindRun("n", telemetryTestRun, at.Add(12*time.Minute)); err != nil {
		t.Fatal(err)
	}
	receipt, err := r.Accept(telemetryBatchFixture(at.Add(23*30*time.Second), 24), at.Add(12*time.Minute), 60)
	if err != nil || receipt.AcceptedCount != 0 || receipt.DuplicateCount != 1 {
		t.Fatal("expiry lost durable watermark", receipt, err)
	}
}

func TestTelemetryHistoryTwoPartitionsRangeAndGaps(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	metricNode(t, s, "n")
	now := time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC)
	start := now.Add(-168 * time.Hour)
	boundary := time.Date(2026, 11, 8, 0, 0, 0, 0, time.UTC)
	times := []time.Time{start.Add(-30 * time.Second), start, boundary.Add(-30 * time.Second), boundary, boundary.Add(30 * time.Second)}
	for i, at := range times {
		if err := s.SaveTelemetryHistory(ctx, []monitoring.NodeHistory{historyFixture("n", at, uint64(i+1))}, at); err != nil {
			t.Fatal(err)
		}
	}
	for _, table := range []string{"metrics_history", "metrics_history_old"} {
		var count int
		if err := s.db.QueryRow(`SELECT count(*) FROM ` + table).Scan(&count); err != nil || count == 0 {
			t.Fatal("both physical partitions must contain rows", table, count, err)
		}
	}
	rows, err := s.TelemetryHistory(ctx, "n", start, now, now, 30)
	if err != nil || len(rows) != 4 {
		t.Fatal("range leaked older data or filled gaps", rows, err)
	}
	for i, row := range rows {
		if row.Start != times[i+1].Unix() || row.FastCount != 1 {
			t.Fatal("cross-partition raw identity changed", row)
		}
	}
	rows, err = s.TelemetryHistory(ctx, "n", start, now, now, 3600)
	if err != nil || len(rows) != 3 {
		t.Fatal("coarse history filled absent hours", rows, err)
	}
	last := rows[2]
	if last.Start != boundary.Unix() || last.FastCount != 2 || last.CPU.Count != 2 || last.CPU.Sum == nil || *last.CPU.Sum != 40 {
		t.Fatal("coarse merge lost sufficient statistics", last)
	}
	if _, err := s.TelemetryHistory(ctx, "n", start.Add(-time.Nanosecond), now, now, 30); err == nil {
		t.Fatal("range exceeding 168h by 1ns accepted")
	}
	if _, err := s.TelemetryHistory(ctx, "n", start.Add(-time.Second), start.Add(time.Hour), now, 30); err == nil {
		t.Fatal("short range older than retention accepted")
	}
}

func TestDiskSummaryStoredOnlyInHistory(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	metricNode(t, s, "n")
	at := time.Date(2026, 11, 3, 0, 0, 0, 0, time.UTC)
	n := historyFixture("n", at, 1)
	d := &n.Buckets[0].DiskIO
	d.WriteSpeed = monitoring.Peak{Max: testValue(0.0), Count: 1}
	d.Await = monitoring.Peak{Max: testValue(2.5), Count: 1}
	d.Util = monitoring.Peak{Max: testValue(30.0), Count: 1}
	d.Quality = monitoring.QualityPartial
	if err := s.SaveTelemetryHistory(ctx, []monitoring.NodeHistory{n}, at); err != nil {
		t.Fatal(err)
	}
	var tables int
	if err := s.db.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('metrics_disk_io','metrics_disk_io_old')`).Scan(&tables); err != nil || tables != 0 {
		t.Fatal(tables, err)
	}
	var read, write, latency, util float64
	var quality uint64
	if err := s.db.QueryRow(`SELECT disk_read_speed_max,disk_write_speed_max,disk_await_ms_max,disk_util_percent_max,disk_io_quality_flags FROM metrics_history WHERE node_id='n'`).Scan(&read, &write, &latency, &util, &quality); err != nil || read != 12 || write != 0 || latency != 2.5 || util != 30 || quality == 0 {
		t.Fatal(read, write, latency, util, quality, err)
	}
	rows, err := s.RestoreTelemetryHistory(ctx, at)
	if err != nil || len(rows) != 1 {
		t.Fatal(rows, err)
	}
	got := rows[0].Buckets[0].DiskIO
	if got.Await.Count != 1 || *got.Await.Max != 2.5 || got.WriteIOPS.Max != nil || got.Quality != d.Quality {
		t.Fatal(got)
	}
}
