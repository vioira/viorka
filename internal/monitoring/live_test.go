package monitoring

import (
	"testing"
	"time"
)

func TestLiveWindowDeltaAndRecovery(t *testing.T) {
	s := New()
	start := time.Now().UTC().Truncate(time.Minute)
	for i := range 400 {
		at := start.Add(time.Duration(i) * time.Second)
		if !s.Put("n", sample(at), at) {
			t.Fatal("new sample rejected")
		}
	}
	now := start.Add(399 * time.Second)
	full := s.Live("n", now, Cursor{})
	if !full.Reset || full.Sequence != 400 || len(full.Points) != 400 || full.Points[0].Sequence != 1 {
		t.Fatalf("bad window: %d %d", full.Sequence, len(full.Points))
	}
	if full.Points[399].Values["cpu"] != 25 || !full.Points[399].At.Equal(now) {
		t.Fatal("projection lost values or sample time")
	}
	if s.Put("n", sample(start), now) {
		t.Fatal("late sample accepted")
	}
	delta := s.Live("n", now, Cursor{398, full.Generation})
	if delta.Reset || len(delta.Points) != 2 || delta.Points[0].Sequence != 399 {
		t.Fatal("delta replay incorrect")
	}
	if s.Live("n", now, Cursor{1, full.Generation}).Reset {
		t.Fatal("retained cursor must not reset")
	}
	if !s.Live("n", now, Cursor{999, full.Generation}).Reset {
		t.Fatal("future cursor must reset")
	}
	expired := s.Live("n", now.Add(11*time.Minute), Cursor{})
	if !expired.Stale || len(expired.Points) != 0 {
		t.Fatal("expired window retained")
	}
	if len(s.Get("n", now, true).History) > 60 {
		t.Fatal("legacy history contract changed")
	}
}

func TestLiveCacheGenerationCannotMixWindows(t *testing.T) {
	s := New()
	now := time.Now()
	s.Put("n", sample(now), now)
	before := s.Live("n", now, Cursor{})
	s.mu.Lock()
	delete(s.entries, "n")
	s.mu.Unlock()
	at := now.Add(time.Second)
	s.Put("n", sample(at), at)
	after := s.Live("n", at, Cursor{before.Sequence, before.Generation})
	if !after.Reset || len(after.Points) != 1 || !after.Points[0].At.Equal(at) {
		t.Fatal("old cache cursor mixed with replacement window")
	}
}

func TestLiveRawRecoveryAndContinuation(t *testing.T) {
	start := time.Now().UTC().Truncate(time.Minute)
	s := New()
	for i := 0; i < 700; i++ {
		at := start.Add(time.Duration(i) * time.Second)
		s.Put("n", sample(at), at)
	}
	now := start.Add(699 * time.Second)
	full := s.Live("n", now, Cursor{})
	if !full.Reset || len(full.Points) != 600 || full.Points[len(full.Points)-1].Sequence != 700 {
		t.Fatalf("bootstrap %+v", full)
	}
	if !s.Live("n", now, Cursor{1, full.Generation}).Reset {
		t.Fatal("evicted cursor must reset")
	}
	if len(s.entries["n"].live) != 600 {
		t.Fatal("raw cache not bounded")
	}
	at := now.Add(time.Second)
	s.Put("n", sample(at), at)
	delta := s.Live("n", at, Cursor{full.Sequence, full.Generation})
	if delta.Reset || len(delta.Points) != 1 || delta.Points[0].Sequence != 701 {
		t.Fatalf("delta %+v", delta)
	}
}

func TestLiveReconnectPreservesSpike(t *testing.T) {
	s := New()
	start := time.Now().UTC().Truncate(time.Minute)
	for i, value := range []float64{0, 90, 0} {
		at := start.Add(time.Duration(i) * time.Second)
		m := sample(at)
		m.CPU.UsagePercent = &value
		s.Put("n", m, at)
	}
	full := s.Live("n", start.Add(2*time.Second), Cursor{})
	delta := s.Live("n", start.Add(2*time.Second), Cursor{1, full.Generation})
	if len(full.Points) != 3 || len(delta.Points) != 2 || full.Points[1].Values["cpu"] != 90 || delta.Points[0].Values["cpu"] != 90 || !full.Points[1].At.Equal(start.Add(time.Second)) {
		t.Fatal("reconnect averaged or moved peak")
	}
}
