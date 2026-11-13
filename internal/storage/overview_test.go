package storage

import (
	"context"
	"github.com/vioira/viorka/internal/proxy"
	"github.com/vioira/viorka/internal/realtime"
	v1 "github.com/vioira/viorka/protocol/v1"
	"testing"
	"time"
)

func TestOverviewPermissionsAndSync(t *testing.T) {
	s := engineFixture(t)
	ctx := context.Background()
	d := saveEngine(t, s, "sing", proxy.Draft{Services: []proxy.Service{sampleService("svc", 443)}})
	summary, err := s.Overview(ctx, "admin")
	if err != nil || summary.Nodes != 2 || summary.Services != 1 || summary.PendingServices != 1 || summary.Tasks.SuccessRate != nil {
		t.Fatalf("summary: %+v %v", summary, err)
	}
	viewer, err := s.Overview(ctx, "viewer")
	if err != nil || viewer.Services != 0 || len(viewer.Attention) != 0 {
		t.Fatalf("private services leaked: %+v %v", viewer, err)
	}
	if _, err = s.db.Exec(`INSERT INTO engine_node_grants(user_id,node_id,can_manage) VALUES('viewer','node',0)`); err != nil {
		t.Fatal(err)
	}
	viewer, err = s.Overview(ctx, "viewer")
	if err != nil || viewer.Services != 1 {
		t.Fatalf("grant: %+v %v", viewer, err)
	}
	dispatch := actionEngine(t, s, "sing", "overview-apply", "engine.apply", d.Version)
	replyEngine(t, s, dispatch, "running")
	summary, err = s.Overview(ctx, "admin")
	if err != nil || summary.Synced != 1 || summary.PendingServices != 0 {
		t.Fatalf("synced: %+v %v", summary, err)
	}
}

func TestOverviewDailyTrafficAggregation(t *testing.T) {
	s := engineFixture(t)
	ctx := context.Background()
	now := time.Date(2026, 11, 13, 12, 0, 0, 0, time.UTC)
	start := now.Truncate(24 * time.Hour)
	save := func(node string, rx string, revision uint64) {
		t.Helper()
		_, err := s.SaveDailyTraffic(ctx, node, []*v1.TelemetryDailyTraffic{{DayStart: start, DayEnd: start.AddDate(0, 0, 1), SampledAt: now, Revision: revision, RXBytes: rx, TXBytes: "200"}})
		if err != nil {
			t.Fatal(err)
		}
	}
	save("node", "9007199254740993", 1)
	save("node", "9007199254740994", 2)
	result, err := s.OverviewTraffic(ctx, 7, time.UTC, now)
	if err != nil || result.RX == nil || *result.RX != "9007199254740994" || !result.Partial || result.Points[0].RX != nil || result.Points[6].ReportingNodes != 1 {
		t.Fatalf("partial: %+v %v", result, err)
	}
	save("other", "10", 1)
	result, err = s.OverviewTraffic(ctx, 1, time.UTC, now)
	if err != nil || result.Partial || *result.RX != "9007199254741004" || *result.TX != "400" {
		t.Fatalf("complete: %+v %v", result, err)
	}
	result, err = s.OverviewTraffic(ctx, 1, time.UTC, now.Add(6*time.Minute))
	if err != nil || !result.Partial {
		t.Fatalf("stale: %+v %v", result, err)
	}
}

func TestDailyTrafficOverviewInvalidation(t *testing.T) {
	s := engineFixture(t)
	sub := s.Events().Subscribe(func(c realtime.Change) bool { return c.Kind == "history" })
	defer sub.Close()
	now := time.Now().UTC()
	start := now.Truncate(24 * time.Hour)
	record := &v1.TelemetryDailyTraffic{DayStart: start, DayEnd: start.Add(24 * time.Hour), SampledAt: now, Revision: 1, RXBytes: "10", TXBytes: "20"}
	for i := 0; i < 2; i++ {
		if _, err := s.SaveDailyTraffic(context.Background(), "node", []*v1.TelemetryDailyTraffic{record}); err != nil {
			t.Fatal(err)
		}
		changes, reset := sub.Drain()
		if reset || (i == 0 && (len(changes) != 1 || changes[0].NodeID != "node")) || (i == 1 && len(changes) != 0) {
			t.Fatalf("invalidation %d: %+v", i, changes)
		}
	}
}
