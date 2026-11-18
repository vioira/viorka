package httpapi

import (
	"context"
	"testing"
	"time"

	"github.com/vioira/viorka/internal/inventory"
	"github.com/vioira/viorka/internal/realtime"
)

type countingOverview struct {
	inventory.Repository
	stats, traffic, nodes int
}

func (r *countingOverview) Overview(context.Context, string) (inventory.Overview, error) {
	r.stats++
	return inventory.Overview{Nodes: r.nodes}, nil
}
func (r *countingOverview) OverviewTraffic(_ context.Context, days int, _ *time.Location, now time.Time) (inventory.OverviewTraffic, error) {
	r.traffic++
	return inventory.OverviewTraffic{ExpectedNodes: r.nodes, End: now.String(), Points: make([]inventory.OverviewTrafficPoint, days)}, nil
}

func TestOverviewThrottlesQueriesAndDeliversTrailingChanges(t *testing.T) {
	var o browserOverview
	repo := &countingOverview{}
	a := &api{Dependencies: Dependencies{Nodes: repo}}
	start := time.Now()
	var frames []browserFrame
	send := func(frame browserFrame) bool { frames = append(frames, frame); return true }
	check := func(elapsed time.Duration, stats, traffic, sent int) {
		t.Helper()
		if !o.send(context.Background(), a, "viewer", send, start.Add(elapsed), false) || repo.stats != stats || repo.traffic != traffic || len(frames) != sent {
			t.Fatalf("at %v: queries %d / %d, frames %v", elapsed, repo.stats, repo.traffic, frames)
		}
	}
	s := browserOverviewSubscription{Generation: 1, TrafficGeneration: 1, Range: "week", Timezone: "UTC"}
	if !o.set(&s) {
		t.Fatal("subscribe")
	}
	check(0, 1, 1, 2)
	o.change(realtime.Change{Kind: "tasks"})
	o.change(realtime.Change{Kind: "history"}) // ordinary monitoring history
	check(4*time.Second, 1, 1, 2)
	check(5*time.Second, 2, 1, 2) // same values
	repo.nodes = 3
	for i := 0; i < 50; i++ {
		o.change(realtime.Change{Kind: "node"})
		o.change(realtime.Change{Kind: "history", DailyTraffic: true})
	}
	check(10*time.Second, 3, 1, 3)
	check(59*time.Second, 3, 1, 3)
	check(time.Minute, 3, 2, 4)
	check(2*time.Minute, 3, 2, 4)
	s.Range, s.TrafficGeneration = "day", 2
	o.set(&s)
	check(2*time.Minute, 3, 3, 5)
	if frames[4].Event != "overview_traffic" || frames[4].Generation != 2 {
		t.Fatal(frames[4])
	}
	o.set(nil)
	o.change(realtime.Change{Kind: "tasks"})
	check(3*time.Minute, 3, 3, 5)
}

func TestBrowserOverviewSnapshotsWithUpdatesDisabled(t *testing.T) {
	f := setup(t, "viewer")
	c := browserTestSocket(t, f)
	s := browserOverviewSubscription{Generation: 1, TrafficGeneration: 1, Range: "week", Timezone: "Asia/Shanghai"}
	browserSend(t, c, browserMessage{Type: "subscribe", Overview: &s})
	if frame := browserReceive(t, c, "overview", ""); frame.Generation != 1 {
		t.Fatal(frame)
	}
	frame := browserReceive(t, c, "overview_traffic", "")
	if data := frame.Data.(map[string]any); len(data["points"].([]any)) != 7 || data["timezone"] != s.Timezone {
		t.Fatal(data)
	}
	s.Range, s.TrafficGeneration = "month", 2
	browserSend(t, c, browserMessage{Type: "subscribe", Overview: &s})
	frame = browserReceive(t, c, "overview_traffic", "")
	if frame.Generation != 2 || len(frame.Data.(map[string]any)["points"].([]any)) != 30 {
		t.Fatal(frame)
	}
}
