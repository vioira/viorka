package monitoring

import (
	"context"
	"errors"
	"fmt"
	v1 "github.com/vioira/viorka/protocol/v1"
	"strings"
	"testing"
	"time"
)

type telemetryMemoryRepo struct{ commits [][]NodeHistory }

func (r *telemetryMemoryRepo) RotateTelemetryHistory(context.Context, time.Time) error { return nil }
func (r *telemetryMemoryRepo) RestoreTelemetryHistory(context.Context, time.Time) ([]NodeHistory, error) {
	return nil, nil
}
func (r *telemetryMemoryRepo) SaveTelemetryHistory(_ context.Context, rows []NodeHistory, _ time.Time) error {
	r.commits = append(r.commits, rows)
	return nil
}
func TestTelemetryForcedFlushWholeNodesAndCancellation(t *testing.T) {
	repo := &telemetryMemoryRepo{}
	ctx := context.Background()
	at := time.Now().UTC().Truncate(30 * time.Second)
	r, err := NewTelemetryRecorder(ctx, repo, at)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 600; i++ {
		if err = recordTestObservation(r, fmt.Sprint(i), at); err != nil {
			t.Fatal(err)
		}
	}
	if err = r.Flush(ctx, at, true); err != nil {
		t.Fatal(err)
	}
	total := 0
	for _, commit := range repo.commits {
		count := 0
		for _, n := range commit {
			count += len(n.Buckets)
			if len(n.Checkpoints) != 1 || n.Checkpoints[0].Sequence != 1 {
				t.Fatal("checkpoint split")
			}
		}
		if count > 512 {
			t.Fatal("oversized transaction")
		}
		total += count
	}
	if total != 600 || len(repo.commits) != 2 {
		t.Fatal("incomplete forced flush", total, len(repo.commits))
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if !errors.Is(r.Flush(cancelled, at, true), context.Canceled) {
		t.Fatal("cancel ignored")
	}
}
func TestTelemetryAdmissionBudgetRejectsWholeBatch(t *testing.T) {
	ctx := context.Background()
	repo := &telemetryMemoryRepo{}
	at := time.Now().UTC().Truncate(30 * time.Second)
	r, err := NewTelemetryRecorder(ctx, repo, at)
	if err != nil {
		t.Fatal(err)
	}
	run := "11111111-1111-4111-8111-111111111111"
	if err = r.BindRun("n", run, at); err != nil {
		t.Fatal(err)
	}
	mounts := []*v1.TelemetryFilesystem{}
	for i := 0; i < 32; i++ {
		mounts = append(mounts, &v1.TelemetryFilesystem{Identity: fmt.Sprint(i), MountPoint: "/" + strings.Repeat("x", 4095), FilesystemType: "ext4", TotalBytes: 100, UsedBytes: 30, AvailableBytes: 60})
	}
	rejected := false
	for seq := uint64(1); seq < 30; seq++ {
		ts := at.Add(time.Duration(seq) * 30 * time.Second)
		batch := v1.TelemetryBatch{NodeID: "n", RunID: run, BatchID: "b", Fast: []*v1.TelemetryFast{}, Full: []*v1.TelemetryFull{{Sequence: seq, SampledAt: ts, Filesystems: mounts}}, PublicIp: []*v1.TelemetryPublicIP{}}
		receipt, e := r.Accept(batch, ts, 60)
		if e != nil {
			if !errors.Is(e, ErrTelemetryOverloaded) || receipt.AcceptedCount != 0 || receipt.State != "rejected" {
				t.Fatal(receipt, e)
			}
			if n := r.nodes["n"]; n.data.Checkpoints[0].Sequence != seq-1 || n.bytes > 4<<20 {
				t.Fatal("rejected batch mutated state")
			}
			rejected = true
			break
		}
	}
	if !rejected {
		t.Fatal("node budget not enforced")
	}
	if r.bytes > telemetryPendingBudget {
		t.Fatal("global budget exceeded")
	}
}
func TestTelemetryNodeLimit(t *testing.T) {
	r, err := NewTelemetryRecorder(context.Background(), &telemetryMemoryRepo{}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < MaxNodes; i++ {
		if err = r.BindRun(fmt.Sprint(i), "run", time.Now()); err != nil {
			t.Fatal(err)
		}
	}
	if !errors.Is(r.BindRun("overflow", "run", time.Now()), ErrTelemetryOverloaded) {
		t.Fatal("node cap ignored")
	}
}

type telemetryCommitHookRepo struct {
	telemetryMemoryRepo
	hook func() error
}

func (r *telemetryCommitHookRepo) SaveTelemetryHistory(ctx context.Context, rows []NodeHistory, now time.Time) error {
	if r.hook != nil {
		hook := r.hook
		r.hook = nil
		if err := hook(); err != nil {
			return err
		}
	}
	return r.telemetryMemoryRepo.SaveTelemetryHistory(ctx, rows, now)
}

func TestTelemetryExpiryTracksBucketCommitVersions(t *testing.T) {
	for _, scenario := range []string{"saved", "failed", "concurrent-same", "concurrent-other"} {
		t.Run(scenario, func(t *testing.T) {
			ctx := context.Background()
			at := time.Now().UTC().Truncate(30 * time.Second)
			repo := &telemetryCommitHookRepo{}
			r, err := NewTelemetryRecorder(ctx, repo, at)
			if err != nil {
				t.Fatal(err)
			}
			run := "11111111-1111-4111-8111-111111111111"
			if err = r.BindRun("n", run, at); err != nil {
				t.Fatal(err)
			}
			var seq uint64
			accept := func(ts time.Time) {
				t.Helper()
				seq++
				_, err = r.Accept(v1.TelemetryBatch{NodeID: "n", RunID: run, BatchID: "batch", Fast: []*v1.TelemetryFast{{Sequence: seq, SampledAt: ts, FilterRevision: strings.Repeat("a", 64)}}, Full: []*v1.TelemetryFull{}, PublicIp: []*v1.TelemetryPublicIP{}}, ts, 60)
				if err != nil {
					t.Fatal(err)
				}
			}
			accept(at)
			switch scenario {
			case "failed":
				repo.hook = func() error { return errors.New("write failed") }
			case "concurrent-same":
				repo.hook = func() error { accept(at.Add(time.Second)); return nil }
			case "concurrent-other":
				repo.hook = func() error { accept(at.Add(30 * time.Second)); return nil }
			}
			err = r.Flush(ctx, at, false)
			if (err != nil) != (scenario == "failed") {
				t.Fatal(err)
			}
			later := at.Add(10*time.Minute + 15*time.Second)
			accept(later)
			if err = r.Flush(ctx, later, true); err != nil {
				t.Fatal(err)
			}
			want := uint64(0)
			if scenario == "failed" || scenario == "concurrent-same" {
				want = 1
			}
			if r.expiredDirty != want {
				t.Fatalf("expired unpersisted=%d want %d", r.expiredDirty, want)
			}
			if _, retained := r.nodes["n"].bucketVersions[at.Unix()]; retained {
				t.Fatal("expired version retained")
			}
			if r.nodes["n"].dirty {
				t.Fatal("successful final flush left dirty node")
			}
		})
	}
}

func recordTestObservation(r *TelemetryRecorder, node string, at time.Time) error {
	const run = "11111111-1111-4111-8111-111111111111"
	if err := r.BindRun(node, run, at); err != nil {
		return err
	}
	_, err := r.Accept(v1.TelemetryBatch{NodeID: node, RunID: run, BatchID: "batch", Fast: []*v1.TelemetryFast{{Sequence: 1, SampledAt: at, FilterRevision: strings.Repeat("a", 64)}}, Full: []*v1.TelemetryFull{}, PublicIp: []*v1.TelemetryPublicIP{}}, at, 60)
	return err
}
