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
	if !full.Reset || full.Sequence != 400 || len(full.Points) != 7 || full.Points[0].Sequence != 60 {
		t.Fatalf("bad window: %d %d", full.Sequence, len(full.Points))
	}
	if full.Points[6].Values["cpu"] != 25 || !full.Points[6].At.Equal(now) {
		t.Fatal("projection lost values or sample time")
	}
	if s.Put("n", sample(start), now) {
		t.Fatal("late sample accepted")
	}
	delta := s.Live("n", now, Cursor{398, full.Generation})
	if delta.Reset || len(delta.Points) != 2 || delta.Points[0].Sequence != 399 {
		t.Fatal("delta replay incorrect")
	}
	if !s.Live("n", now, Cursor{1, full.Generation}).Reset {
		t.Fatal("evicted cursor must reset")
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

func TestLiveMinuteMeansAndRawContinuation(t *testing.T) {
	start := time.Date(2026, 10, 31, 0, 0, 0, 0, time.UTC)
	points := []LivePoint{
		{Sequence: 1, At: start, ReceivedAt: start, Values: map[string]float64{"cpu": 10, "memory": 30}},
		{Sequence: 2, At: start.Add(30 * time.Second), ReceivedAt: start.Add(30 * time.Second), Values: map[string]float64{"cpu": 30}},
		{Sequence: 3, At: start.Add(time.Minute), ReceivedAt: start.Add(time.Minute), Values: map[string]float64{"cpu": 0}},
	}
	got := minuteLivePoints(points)
	if len(got) != 2 || got[0].Values["cpu"] != 20 || got[0].Values["memory"] != 30 || got[0].Sequence != 2 || got[1].Values["cpu"] != 0 {
		t.Fatalf("means %+v", got)
	}
	if _, ok := got[1].Values["memory"]; ok {
		t.Fatal("invented missing metric")
	}
	if points[0].Values["cpu"] != 10 {
		t.Fatal("mutated cache")
	}
	s := New()
	for i := 0; i < 700; i++ {
		at := start.Add(time.Duration(i) * time.Second)
		s.Put("n", sample(at), at)
	}
	now := start.Add(699 * time.Second)
	full := s.Live("n", now, Cursor{})
	if !full.Reset || len(full.Points) > 11 || full.Points[len(full.Points)-1].Sequence != 700 {
		t.Fatalf("bootstrap %+v", full)
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
