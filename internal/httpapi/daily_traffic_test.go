package httpapi

import (
	"context"
	"encoding/json"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/monitoring"
	v1 "github.com/vioira/viorka/protocol/v1"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestDailyTrafficIngressAndAPI(t *testing.T) {
	f := setup(t, "admin")
	node, key := f.enroll()
	token := f.token(node, key)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Millisecond)
	recorder, err := monitoring.NewTelemetryRecorder(ctx, f.store, now)
	if err != nil {
		t.Fatal(err)
	}
	ingress := monitoring.NewTelemetryIngress(recorder)
	ingress.ConfigureDailyTraffic(f.store)
	raw, err := os.ReadFile("../../api/agent/v1/examples/node.metrics.v3.json")
	if err != nil {
		t.Fatal(err)
	}
	var envelope struct {
		Payload v1.TelemetryBatch `json:"payload"`
	}
	if err = json.Unmarshal(raw, &envelope); err != nil {
		t.Fatal(err)
	}
	b := envelope.Payload
	b.NodeID = node
	b.Fast[0].SampledAt = now
	b.Full[0].SampledAt = now
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	b.DailyTraffic = []*v1.TelemetryDailyTraffic{{DayStart: start, DayEnd: start.AddDate(0, 0, 1), RXBytes: "1234", TXBytes: "5678", SampledAt: now, Revision: 1}}
	raw, _ = json.Marshal(b)
	activate := func(enabled bool) {
		t.Helper()
		if err := ingress.Activate(node, auth.Hash(token), "generation", now.Add(time.Hour), v1.DefaultTelemetrySettings(), now, false, enabled); err != nil {
			t.Fatal(err)
		}
	}
	activate(false)
	if _, err = ingress.Receive(ctx, node, auth.Hash(token), "", raw, true, now); err == nil {
		t.Fatal("unnegotiated extension accepted")
	}
	activate(true)
	for _, http := range []bool{true, false} {
		receipt, err := ingress.Receive(ctx, node, auth.Hash(token), "generation", raw, http, now)
		if err != nil || len(receipt.DailyTrafficAcks) != 1 || receipt.DailyTrafficAcks[0].Revision != 1 {
			t.Fatal(receipt, err)
		}
	}
	// Durable records remain available even through a new ingress with an empty live cache.
	restarted := monitoring.NewTelemetryIngress(recorder)
	restarted.ConfigureDailyTraffic(f.store)
	live, err := restarted.Live(node, now, monitoring.Cursor{}, false, true)
	if err != nil || live.DailyTraffic == nil || live.DailyTraffic.RXBytes != "1234" {
		t.Fatal(live, err)
	}
	handler := NewRouter(Dependencies{Auth: f.users, Nodes: f.store, DailyTraffic: f.store})
	path := "/api/v1/nodes/" + node + "/traffic/daily"
	for _, tc := range []struct {
		suffix        string
		authenticated bool
		status        int
	}{{"", true, 200}, {"", false, 401}, {"?start=bad", true, 400}, {"?extra=1", true, 400}, {"?start=2026-01-01T00:00:00Z&end=2028-01-01T00:00:00Z", true, 400}} {
		req := httptest.NewRequest("GET", path+tc.suffix, nil)
		if tc.authenticated {
			req.AddCookie(f.cookie)
		}
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != tc.status {
			t.Fatal(res.Code, res.Body.String())
		}
		if tc.status == 200 {
			var body DailyTrafficResponse
			if json.Unmarshal(res.Body.Bytes(), &body) != nil || len(body.Items) != 1 || body.Items[0].TXBytes != "5678" {
				t.Fatal(res.Body.String())
			}
		}
	}
	// A conflicting snapshot cannot obtain a durable acknowledgement or change the row.
	b.DailyTraffic[0].RXBytes = "9999"
	raw, _ = json.Marshal(b)
	receipt, err := ingress.Receive(ctx, node, auth.Hash(token), "generation", raw, true, now)
	if err == nil || len(receipt.DailyTrafficAcks) > 0 {
		t.Fatal("conflict acknowledged", receipt, err)
	}
}
