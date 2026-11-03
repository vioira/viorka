package monitoring

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	v1 "github.com/vioira/viorka/protocol/v1"
)

func TestTelemetryLiveBoundsCursorsAndOwnership(t *testing.T) {
	batch, start := ingressFixture(t)
	settings := v1.DefaultTelemetrySettings()
	cache := newTelemetryLiveCache()
	for i := 0; i < 605; i++ {
		batch.Fast[0].Sequence = uint64(i + 1)
		batch.Fast[0].SampledAt = start.Add(time.Duration(i) * time.Second)
		next, err := cache.prepare(batch, batch.Fast[0].SampledAt, settings, [3]uint64{})
		if err != nil {
			t.Fatal(err)
		}
		cache.commit(batch.NodeID, next)
	}
	now := start.Add(604 * time.Second)
	live, err := cache.get(batch.NodeID, now, Cursor{}, false, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(live.Points) != 600 || live.Sequence != 605 || !live.Reset || live.Fast.Sequence != "605" {
		t.Fatalf("live bounds seq=%d points=%d", live.Sequence, len(live.Points))
	}
	generation := live.Generation
	summary, err := cache.get(batch.NodeID, now, Cursor{}, false, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(summary.Points) != 0 || len(summary.Fast.Interfaces) != 0 || len(summary.Full.Filesystems) != 0 || len(summary.Full.DiskIo) != 0 {
		t.Fatal("summary retained device arrays")
	}
	if live.Points[0].Sequence != 6 {
		t.Fatal("old points retained")
	}
	live.Points[0].Values["cpu_percent"] = 99
	live.Fast.Interfaces[0].Name = "mutated"
	again, err := cache.get(batch.NodeID, now, Cursor{Generation: generation, Sequence: 604}, false, false)
	if err != nil {
		t.Fatal(err)
	}
	if again.Reset || len(again.Points) != 1 || again.Points[0].Sequence != 605 || again.Fast.Interfaces[0].Name == "mutated" {
		t.Fatal("delta cursor or snapshot alias")
	}
	replay, err := cache.get(batch.NodeID, now, Cursor{Generation: generation, Sequence: 1}, false, false)
	if err != nil {
		t.Fatal(err)
	}
	if !replay.Reset || replay.Points[0].Values["cpu_percent"] == 99 {
		t.Fatal("evicted cursor or map alias")
	}
	// Duplicate transport receipts update only overall receipt time, never add
	// points or make a cached slow group a newly sampled observation.
	next, err := cache.prepare(batch, now.Add(time.Second), settings, [3]uint64{})
	if err != nil {
		t.Fatal(err)
	}
	cache.commit(batch.NodeID, next)
	duplicate, err := cache.get(batch.NodeID, now.Add(time.Second), Cursor{Generation: generation, Sequence: 605}, false, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(duplicate.Points) != 0 || !duplicate.FastReceivedAt.Equal(now) || !duplicate.FullReceivedAt.Equal(start) || !duplicate.MetricsReceivedAt.Equal(now.Add(time.Second)) {
		t.Fatal("duplicate changed group provenance")
	}
	batch.RunID = "22222222-2222-4222-8222-222222222222"
	batch.Fast[0].Sequence = 1
	next, err = cache.prepare(batch, now.Add(2*time.Second), settings, [3]uint64{})
	if err != nil {
		t.Fatal(err)
	}
	cache.commit(batch.NodeID, next)
	replaced, err := cache.get(batch.NodeID, now.Add(2*time.Second), Cursor{Generation: generation, Sequence: 605}, false, false)
	if err != nil {
		t.Fatal(err)
	}
	if !replaced.Reset || replaced.Generation == generation || len(replaced.Points) != 1 {
		t.Fatal("new run did not reset live window")
	}
	cache.forget(batch.NodeID)
	if cache.bytes != 0 || len(cache.entries) != 0 {
		t.Fatal("cache budget leaked on delete")
	}
}
func TestTelemetryIngressLiveAdmissionAndNotification(t *testing.T) {
	batch, now := ingressFixture(t)
	ctx := context.Background()
	recorder, err := NewTelemetryRecorder(ctx, &telemetryMemoryRepo{}, now)
	if err != nil {
		t.Fatal(err)
	}
	ingress := NewTelemetryIngress(recorder)
	session := strings.Repeat("a", 64)
	if err = ingress.Activate(batch.NodeID, session, "generation", now.Add(time.Hour), v1.DefaultTelemetrySettings(), now); err != nil {
		t.Fatal(err)
	}
	notifications := 0
	ingress.SetNotifier(func(node string) {
		// Reentrant read proves callbacks run outside the admission lock and after
		// both stores committed, rather than notifying about a partial update.
		live, err := ingress.Live(node, now, Cursor{}, false, false)
		if err != nil || live.Fast == nil || recorder.nodes[node] == nil {
			t.Error("notification before atomic commit", err)
		}
		notifications++
	})
	raw, err := json.Marshal(batch)
	if err != nil {
		t.Fatal(err)
	}
	ingress.live.bytes = telemetryLiveBudget
	if _, err = ingress.Receive(ctx, batch.NodeID, session, "", raw, true, now); !errors.Is(err, ErrTelemetryOverloaded) {
		t.Fatalf("unbounded cache: %v", err)
	}
	if recorder.nodes[batch.NodeID] != nil || ingress.bindings[batch.NodeID].run != "" || notifications != 0 {
		t.Fatal("cache rejection mutated history")
	}
	ingress.live.bytes = 0
	if _, err = ingress.Receive(ctx, batch.NodeID, session, "", raw, true, now); err != nil {
		t.Fatal(err)
	}
	if _, err = ingress.Receive(ctx, batch.NodeID, session, "generation", raw, false, now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	live, err := ingress.Live(batch.NodeID, now.Add(time.Second), Cursor{}, false, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(live.Points) != 1 || notifications != 2 || live.Fast.Interfaces[0].RXBytes != "9007199254740993" {
		t.Fatal("dual transport duplicated point or rounded counter")
	}
	ingress.Forget(batch.NodeID)
	missing, err := ingress.Live(batch.NodeID, now, Cursor{}, false, false)
	if err != nil || missing.Fast != nil || !missing.FastStale {
		t.Fatal("forgotten snapshot remains", err)
	}
}

type liveRestoreRepo struct{ telemetryMemoryRepo }

func (r *liveRestoreRepo) RestoreTelemetryHistory(context.Context, time.Time) ([]NodeHistory, error) {
	if len(r.commits) == 0 {
		return nil, nil
	}
	rows := r.commits[len(r.commits)-1]
	out := make([]NodeHistory, len(rows))
	for i, row := range rows {
		out[i] = cloneHistory(row)
	}
	return out, nil
}

func TestTelemetryLiveRestoredWatermarksDoNotReplay(t *testing.T) {
	batch, now := ingressFixture(t)
	ctx := context.Background()
	repo := &liveRestoreRepo{}
	recorder, err := NewTelemetryRecorder(ctx, repo, now)
	if err != nil {
		t.Fatal(err)
	}
	session := strings.Repeat("a", 64)
	makeIngress := func(r *TelemetryRecorder) *TelemetryIngress {
		t.Helper()
		s := NewTelemetryIngress(r)
		if err := s.Activate(batch.NodeID, session, "generation", now.Add(time.Hour), v1.DefaultTelemetrySettings(), now); err != nil {
			t.Fatal(err)
		}
		return s
	}
	ingress := makeIngress(recorder)
	receive := func(s *TelemetryIngress) {
		t.Helper()
		raw, err := json.Marshal(batch)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = s.Receive(ctx, batch.NodeID, session, "", raw, true, now); err != nil {
			t.Fatal(err)
		}
	}
	batch.Fast[0].Sequence = 2
	receive(ingress)
	if err = recorder.Flush(ctx, now, true); err != nil {
		t.Fatal(err)
	}
	restored, err := NewTelemetryRecorder(ctx, repo, now)
	if err != nil {
		t.Fatal(err)
	}
	ingress = makeIngress(restored)
	batch.Fast[0].Sequence = 1
	receive(ingress)
	view, err := ingress.Live(batch.NodeID, now, Cursor{}, false, false)
	if err != nil {
		t.Fatal(err)
	}
	if view.Fast != nil || len(view.Points) != 0 {
		t.Fatal("below-watermark observation entered restored live cache")
	}
	batch.Fast[0].Sequence = 2
	receive(ingress)
	view, err = ingress.Live(batch.NodeID, now, Cursor{}, false, false)
	if err != nil {
		t.Fatal(err)
	}
	if view.Fast == nil || view.Fast.Sequence != "2" || len(view.Points) != 0 {
		t.Fatal("cached latest should restore snapshot without replaying a point")
	}
	batch.Fast[0].Sequence = 3
	receive(ingress)
	view, err = ingress.Live(batch.NodeID, now, Cursor{}, false, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Points) != 1 || view.Points[0].SampleSequence != "3" {
		t.Fatal("new observation not appended once")
	}
}
