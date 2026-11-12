package monitoring

import (
	"context"
	v1 "github.com/vioira/viorka/protocol/v1"
	"testing"
	"time"
)

func TestTCPHistoryConcurrentFlushKeepsNewerPoint(t *testing.T) {
	ctx := context.Background()
	at := time.Date(2026, 11, 12, 0, 0, 0, 0, time.UTC)
	repo := &telemetryCommitHookRepo{}
	r, err := NewTelemetryRecorder(ctx, repo, at)
	if err != nil {
		t.Fatal(err)
	}
	run := "11111111-1111-4111-8111-111111111111"
	if err = r.BindRun("n", run, at); err != nil {
		t.Fatal(err)
	}
	accept := func(seq uint64, offset time.Duration) {
		t.Helper()
		when := at.Add(offset)
		ms := float64(seq)
		_, e := r.Accept(v1.TelemetryBatch{NodeID: "n", RunID: run, BatchID: "tcp", Fast: []*v1.TelemetryFast{}, Full: []*v1.TelemetryFull{{Sequence: seq, SampledAt: when, TcpProbes: &v1.TelemetryTCPProbeBatch{SampledAt: when, Targets: []*v1.TelemetryTCPProbe{{Target: "example.com:443", Ping: ms, Loss: 0}}}}}, PublicIp: []*v1.TelemetryPublicIP{}}, when, 60)
		if e != nil {
			t.Fatal(e)
		}
	}
	accept(1, 0)
	repo.hook = func() error { accept(2, 30*time.Second); return nil }
	if err = r.Flush(ctx, at.Add(time.Minute), false); err != nil {
		t.Fatal(err)
	}
	if len(r.nodes["n"].data.TCPProbes) != 1 || !r.nodes["n"].dirty {
		t.Fatal("concurrent point discarded")
	}
	if err = r.Flush(ctx, at.Add(time.Minute), true); err != nil {
		t.Fatal(err)
	}
	if len(repo.commits) != 2 || len(r.nodes["n"].data.TCPProbes) != 0 || r.nodes["n"].dirty {
		t.Fatal("pending points not drained")
	}
	if repo.commits[0][0].TCPProbes[0].Targets[0].Ping != 1 || repo.commits[1][0].TCPProbes[0].Targets[0].Ping != 2 {
		t.Fatal("commit snapshot mutated")
	}
}

func TestTCPHistoryQueryBounds(t *testing.T) {
	now := time.Date(2026, 11, 12, 0, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		duration time.Duration
		period   int
		valid    bool
	}{
		{time.Hour, 60, true}, {6 * time.Hour, 300, true}, {24 * time.Hour, 900, true}, {168 * time.Hour, 3600, true},
		{168 * time.Hour, 60, false}, {169 * time.Hour, 3600, false}, {time.Hour, 30, false},
	} {
		err := ValidateTCPHistoryRange(now.Add(-tc.duration), now, now, tc.period)
		if (err == nil) != tc.valid {
			t.Fatal(tc, err)
		}
	}
}
