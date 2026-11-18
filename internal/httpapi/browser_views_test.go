package httpapi

import (
	"context"
	"testing"
	"time"

	"github.com/vioira/viorka/internal/realtime"
)

func TestBrowserTaskPageAndScopedChanges(t *testing.T) {
	f := setup(t, "admin")
	node, _ := f.enroll()
	c := browserTestSocket(t, f)
	views := map[string]browserView{"task_page": {State: "all", Generation: 1}}
	browserSend(t, c, browserMessage{Type: "subscribe", Enabled: true, Views: views})
	page := browserReceive(t, c, "task_page", "")
	if page.Generation != 1 || len(page.Data.(map[string]any)["items"].([]any)) != 0 {
		t.Fatal(page)
	}
	task, err := f.store.CreateTask(context.Background(), f.session.User.ID, node, "first")
	if err != nil {
		t.Fatal(err)
	}
	page = browserReceive(t, c, "task_page", "")
	rows := page.Data.(map[string]any)["items"].([]any)
	if len(rows) != 1 || rows[0].(map[string]any)["id"] != task.ID {
		t.Fatal(page)
	}
	views["task_page"] = browserView{State: "failed", Generation: 2}
	browserSend(t, c, browserMessage{Type: "subscribe", Views: views})
	page = browserReceive(t, c, "task_page", "")
	if page.Generation != 2 || len(page.Data.(map[string]any)["items"].([]any)) != 0 {
		t.Fatal(page)
	}
	views = map[string]browserView{"task_summary": {Generation: 3}}
	browserSend(t, c, browserMessage{Type: "subscribe", Views: views})
	stats := browserReceive(t, c, "task_summary", "")
	if stats.Data.(map[string]any)["active"] != float64(1) {
		t.Fatal(stats)
	}
	scope := []browserChangeSubscription{{Kind: "tasks", TaskID: task.ID}}
	if !validBrowserChanges(scope) || matchesBrowserChange(scope, realtime.Change{Kind: "tasks", TaskID: "other"}) || !matchesBrowserChange(scope, realtime.Change{Kind: "tasks", TaskID: task.ID}) {
		t.Fatal(scope)
	}
}

func TestBrowserHistoryViewClockAndDeltas(t *testing.T) {
	views := browserViews{}
	if !views.set(map[string]browserView{"minute_history": {Generation: 1, Node: "a", Range: "10m"}, "metric_trends": {Generation: 2, Node: "a", Range: "1h"}}) {
		t.Fatal("valid views")
	}
	now := time.Now()
	for _, v := range views {
		v.dirty = false
	}
	views.change(realtime.Change{Kind: "history", NodeID: "b"})
	views.change(realtime.Change{Kind: "history", NodeID: "a", DailyTraffic: true})
	if views.due(now) {
		t.Fatal("unrelated history invalidated views")
	}
	views.change(realtime.Change{Kind: "history", NodeID: "a"})
	minutes, trends := views["minute_history"], views["metric_trends"]
	minutes.next = now.Add(time.Minute)
	trends.next = now.Add(30 * time.Second)
	if views.due(now.Add(29*time.Second)) || !trends.due(now.Add(30*time.Second)) || minutes.due(now.Add(59*time.Second)) || !minutes.due(now.Add(time.Minute)) {
		t.Fatal("wrong cadence")
	}
	first := HistoryResponse{PeriodSeconds: 60, Points: []HistoryPoint{{Start: 60, LastSample: 1}, {Start: 120, LastSample: 2}}}
	if d := minutes.minuteDelta(first); !d.Reset || len(d.Points) != 2 {
		t.Fatal(d)
	}
	if d := minutes.minuteDelta(first); d.Reset || len(d.Points)+len(d.Removed) != 0 {
		t.Fatal(d)
	}
	next := HistoryResponse{PeriodSeconds: 60, Points: []HistoryPoint{{Start: 120, LastSample: 3}, {Start: 180, LastSample: 4}}}
	d := minutes.minuteDelta(next)
	if d.Reset || len(d.Points) != 2 || d.Points[0].LastSample != 3 || len(d.Removed) != 1 || d.Removed[0] != 60 {
		t.Fatal(d)
	}
	views.reset()
	if !views["minute_history"].minuteDelta(next).Reset {
		t.Fatal("missing resync snapshot")
	}
	views.set(nil)
	if len(views) != 0 {
		t.Fatal("views still subscribed")
	}
}

func TestBrowserConfigurationAndRecoveryRequireOperator(t *testing.T) {
	f := setup(t, "viewer")
	c := browserTestSocket(t, f)
	for _, method := range []string{"getEngineConfiguration", "listSubscriptionRecoveries", "getSubscriptionRecovery"} {
		browserSend(t, c, browserMessage{Type: "request", Method: method, ID: "check", Params: browserParams{ID: "engine", Task: "task"}})
		if frame := browserReceive(t, c, "", "check"); frame.Status != 403 {
			t.Fatal(frame)
		}
	}
}
