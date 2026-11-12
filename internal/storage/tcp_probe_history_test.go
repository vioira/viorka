package storage

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/vioira/viorka/internal/monitoring"
	"github.com/vioira/viorka/internal/realtime"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func tcpPoint(at time.Time, ms float64) monitoring.TCPHistoryPoint {
	return monitoring.TCPHistoryPoint{BucketStart: at.Truncate(time.Minute).Unix(), TelemetryTCPProbeBatch: v1.TelemetryTCPProbeBatch{SampledAt: at, Targets: []*v1.TelemetryTCPProbe{{Target: "example.com:443", Ping: ms, Loss: 20}}}}
}
func TestTCPHistoryCommitRestartAndRollback(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "tcp.db")
	s, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { s.Close() }()
	metricNode(t, s, "n")
	at := time.Date(2026, 11, 12, 0, 0, 10, 0, time.UTC)
	recorder, err := monitoring.NewTelemetryRecorder(ctx, s, at)
	if err != nil {
		t.Fatal(err)
	}
	run := "11111111-1111-4111-8111-111111111111"
	if err = recorder.BindRun("n", run, at); err != nil {
		t.Fatal(err)
	}
	accept := func(seq uint64, sample time.Time, ms float64) {
		t.Helper()
		p := tcpPoint(sample, ms)
		batch := v1.TelemetryBatch{NodeID: "n", RunID: run, BatchID: "tcp", Fast: []*v1.TelemetryFast{}, Full: []*v1.TelemetryFull{{Sequence: seq, SampledAt: at.Add(time.Minute), TcpProbes: &p.TelemetryTCPProbeBatch}}, PublicIp: []*v1.TelemetryPublicIP{}}
		if _, err := recorder.Accept(batch, at.Add(time.Minute), 60); err != nil {
			t.Fatal(err)
		}
	}
	read := func() monitoring.TCPHistory {
		t.Helper()
		h, e := s.TCPProbeHistory(ctx, "n", "", at.Add(-time.Minute), at.Add(2*time.Minute), at.Add(2*time.Minute), 60)
		if e != nil {
			t.Fatal(e)
		}
		return h
	}
	accept(1, at, 30)
	accept(1, at, 99)
	if len(read().Points) != 0 {
		t.Fatal("uncommitted point escaped")
	}
	if err = recorder.Flush(ctx, at.Add(time.Minute), true); err != nil {
		t.Fatal(err)
	}
	if h := read(); len(h.Points) != 1 || h.Points[0].Targets[0].Ping != 30 {
		t.Fatal(h)
	}
	sub := s.Events().Subscribe(func(c realtime.Change) bool { return c.Kind == "tcp_history" })
	defer sub.Close()
	accept(2, at.Add(20*time.Second), 40)
	if _, err = s.db.Exec(`CREATE TRIGGER reject_tcp_checkpoint BEFORE UPDATE ON metric_ingest_checkpoints BEGIN SELECT RAISE(ABORT,'test failure'); END`); err != nil {
		t.Fatal(err)
	}
	if err = recorder.Flush(ctx, at.Add(time.Minute), true); err == nil {
		t.Fatal("write failure swallowed")
	}
	if changes, _ := sub.Drain(); len(changes) != 0 {
		t.Fatal("rollback published TCP history", changes)
	}
	if h := read(); h.Points[0].Targets[0].Ping != 30 {
		t.Fatal("partial transaction", h)
	}
	if _, err = s.db.Exec(`DROP TRIGGER reject_tcp_checkpoint`); err != nil {
		t.Fatal(err)
	}
	if err = recorder.Flush(ctx, at.Add(time.Minute), true); err != nil {
		t.Fatal(err)
	}
	// A later full sample can carry an older cached probe; it must not regress history.
	accept(3, at, 90)
	if err = recorder.Flush(ctx, at.Add(time.Minute), true); err != nil {
		t.Fatal(err)
	}
	s.Close()
	s, err = Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	recorder, err = monitoring.NewTelemetryRecorder(ctx, s, at.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if err = recorder.BindRun("n", run, at); err != nil {
		t.Fatal(err)
	}
	accept(3, at.Add(40*time.Second), 999)
	if err = recorder.Flush(ctx, at.Add(time.Minute), true); err != nil {
		t.Fatal(err)
	}
	if h := read(); len(h.Points) != 1 || h.Points[0].Targets[0].Ping != 40 || h.Points[0].Targets[0].Loss != 20 {
		t.Fatal("restart/replay changed history", h)
	}
	backup := filepath.Join(t.TempDir(), "backup.db")
	if err = s.Backup(ctx, backup); err != nil {
		t.Fatal(err)
	}
	if err = ValidateSnapshot(ctx, backup); err != nil {
		t.Fatal(err)
	}
	restored, err := Open(ctx, backup)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	h, err := restored.TCPProbeHistory(ctx, "n", "", at.Add(-time.Minute), at.Add(time.Minute), at.Add(time.Minute), 60)
	if err != nil || len(h.Points) != 1 || h.Points[0].Targets[0].Ping != 40 {
		t.Fatal("backup lost TCP history", h, err)
	}
}

func TestTCPHistoryPartitionsResolutionAndConstraints(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	metricNode(t, s, "n")
	// Sunday midnight crosses the shared UTC week boundary.
	boundary := time.Date(2026, 11, 15, 0, 0, 0, 0, time.UTC)
	before := tcpPoint(boundary.Add(-time.Minute), 20)
	if err := s.SaveTelemetryHistory(ctx, []monitoring.NodeHistory{{Node: "n", TCPProbes: []monitoring.TCPHistoryPoint{before}}}, before.SampledAt); err != nil {
		t.Fatal(err)
	}
	after := tcpPoint(boundary.Add(time.Minute), 50)
	unknown := tcpPoint(boundary.Add(2*time.Minute), 0)
	unknown.Targets[0].Ping = -1
	unknown.Targets[0].Loss = 100
	if err := s.SaveTelemetryHistory(ctx, []monitoring.NodeHistory{{Node: "n", TCPProbes: []monitoring.TCPHistoryPoint{after, unknown}}}, boundary.Add(3*time.Minute)); err != nil {
		t.Fatal(err)
	}
	h, err := s.TCPProbeHistory(ctx, "n", "", boundary.Add(-time.Minute), boundary.Add(5*time.Minute), boundary.Add(5*time.Minute), 60)
	if err != nil || len(h.Points) != 3 || h.Points[2].Targets[0].Ping != -1 || h.Points[2].Targets[0].Loss != 100 {
		t.Fatal(h, err)
	}
	h, err = s.TCPProbeHistory(ctx, "n", "", boundary.Add(-time.Minute), boundary.Add(5*time.Minute), boundary.Add(5*time.Minute), 300)
	if err != nil || len(h.Points) != 2 || h.Points[1].Targets[0].Ping != -1 {
		t.Fatal("must retain latest unknown, not older success", h, err)
	}
	bad := after
	bad.Targets[0].Loss = 101
	if err = s.SaveTelemetryHistory(ctx, []monitoring.NodeHistory{{Node: "n", TCPProbes: []monitoring.TCPHistoryPoint{bad}}}, boundary); err == nil {
		t.Fatal("missing SQL constraint")
	}
	if err = s.RotateTelemetryHistory(ctx, boundary.Add(15*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"tcp_probe_history", "tcp_probe_history_old"} {
		var count int
		if err = s.db.QueryRow(`SELECT count(*) FROM ` + table).Scan(&count); err != nil || count != 0 {
			t.Fatal(table, count, err)
		}
	}
	down, err := os.ReadFile("../../migrations/0018_tcp_probe_history.down.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(string(down)); err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(`SELECT * FROM tcp_probe_history`); err == nil {
		t.Fatal("rollback left TCP table")
	}
}

func TestTCPHistoryWholeBatchReplacement(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	metricNode(t, s, "n")
	at := time.Date(2026, 11, 12, 0, 0, 1, 0, time.UTC)
	point := tcpPoint(at, 20)
	point.Targets = append(point.Targets, &v1.TelemetryTCPProbe{Target: "other.example:443", Ping: -1, Loss: 100}, &v1.TelemetryTCPProbe{Target: "third.example:443", Ping: 30, Loss: 0})
	save := func(p monitoring.TCPHistoryPoint) {
		t.Helper()
		if err := s.SaveTelemetryHistory(ctx, []monitoring.NodeHistory{{Node: "n", TCPProbes: []monitoring.TCPHistoryPoint{p}}}, at.Add(time.Minute)); err != nil {
			t.Fatal(err)
		}
	}
	save(point)
	var count int
	if err := s.db.QueryRow(`SELECT count(*) FROM tcp_probe_history WHERE node_id='n'`).Scan(&count); err != nil || count != 1 {
		t.Fatal("not one row per batch", count, err)
	}
	next := tcpPoint(at.Add(20*time.Second), 40)
	next.Targets[0].Target = "third.example:443"
	save(next)
	save(point)
	var target string
	var second, third any
	if err := s.db.QueryRow(`SELECT target_1,target_2,target_3 FROM tcp_probe_history WHERE node_id='n'`).Scan(&target, &second, &third); err != nil || target != "third.example:443" || second != nil || third != nil {
		t.Fatal("stale columns after replacement", target, second, third, err)
	}
	h, err := s.TCPProbeHistory(ctx, "n", "", at.Add(-time.Second), at.Add(time.Minute), at.Add(time.Minute), 60)
	if err != nil || len(h.Points) != 1 || len(h.Points[0].Targets) != 1 || h.Points[0].Targets[0].Target != "third.example:443" {
		t.Fatal(h, err)
	}
	for _, query := range []string{
		`UPDATE tcp_probe_history SET target_2='example.org:443'`,
		`UPDATE tcp_probe_history SET loss_1=1.5`,
		`UPDATE tcp_probe_history SET ping_1=-1,loss_1=0`,
		`UPDATE tcp_probe_history SET target_2=target_1,ping_2=ping_1,loss_2=loss_1`,
	} {
		if _, err := s.db.Exec(query); err == nil {
			t.Fatal("invalid row accepted", query)
		}
	}
}
