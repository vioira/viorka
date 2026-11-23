package httpapi

import (
	"encoding/json"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/monitoring"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func TestNodeUptimeSessionAndReplay(t *testing.T) {
	f := setup(t, "admin")
	node, key := f.enroll()
	session := auth.Hash(f.token(node, key))
	ctx := t.Context()
	now := time.Now().UTC().Truncate(30 * time.Second)
	sampled := now.Add(-time.Minute + time.Second)
	recorder, err := monitoring.NewTelemetryRecorder(ctx, f.store, now)
	if err != nil {
		t.Fatal(err)
	}
	ingress := monitoring.NewTelemetryIngress(recorder)
	ingress.ConfigureUptime(f.store)
	activate := func(slow bool) {
		t.Helper()
		if err := ingress.Activate(node, session, "g", now.Add(time.Hour), v1.DefaultTelemetrySettings(), now, monitoring.TelemetryCapabilities{SlowUptime: slow}); err != nil {
			t.Fatal(err)
		}
	}
	data, err := os.ReadFile("../../api/agent/v1/examples/node.metrics.v3.slow_uptime.json")
	if err != nil {
		t.Fatal(err)
	}
	var e struct {
		Payload v1.TelemetryBatch `json:"payload"`
	}
	if err = json.Unmarshal(data, &e); err != nil {
		t.Fatal(err)
	}
	b := e.Payload
	b.NodeID = node
	b.Full = []*v1.TelemetryFull{}
	fast, ip := b.Fast[0], b.PublicIp[0]
	fast.SampledAt = now
	ip.SampledAt = now
	ip.Uptime.SampledAt = sampled
	send := func(token string, expect error) {
		t.Helper()
		raw, err := json.Marshal(b)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = ingress.Receive(ctx, node, token, "g", raw, false, now); !errors.Is(err, expect) {
			t.Fatalf("receive: %v, want %v", err, expect)
		}
	}
	check := func(seconds float64, ts time.Time) {
		t.Helper()
		n, err := f.store.Node(ctx, node)
		if err != nil {
			t.Fatal(err)
		}
		if ts.IsZero() {
			if n.UptimeSeconds != nil || n.UptimeSampledAt != nil {
				t.Fatal("invalid batch wrote uptime")
			}
			return
		}
		if n.UptimeSeconds == nil || *n.UptimeSeconds != seconds || n.UptimeSampledAt == nil {
			t.Fatal(n)
		}
		got, err := time.Parse(time.RFC3339Nano, *n.UptimeSampledAt)
		if err != nil || !got.Equal(ts) {
			t.Fatal(got, ts, err)
		}
	}
	checkHistory := func(seconds float64, ts time.Time) {
		t.Helper()
		if err := recorder.Flush(ctx, now, true); err != nil {
			t.Fatal(err)
		}
		path := "/api/v1/nodes/" + node + "/metrics/history"
		history := decodeResponse[HistoryResponse](t, f.request("GET", path, nil, true), 200)
		if len(history.Points) != 2 {
			t.Fatalf("expected an uptime bucket and a separate CPU bucket, got %+v", history.Points)
		}
		uptime, cpu := history.Points[0], history.Points[1]
		if uptime.Start != ts.Truncate(30*time.Second).Unix() || uptime.LastSample != ts.UnixMilli() ||
			uptime.Uptime == nil || *uptime.Uptime != seconds || uptime.CPU.Average != nil ||
			cpu.Start != now.Unix() || cpu.Uptime != nil || cpu.CPU.Average == nil {
			t.Fatalf("unexpected history: %+v", history.Points)
		}
	}
	activate(false)
	send(session, v1.ErrTelemetryPayload)
	b.PublicIp = []*v1.TelemetryPublicIP{}
	send(session, v1.ErrTelemetryPayload) // A base v3 fast sample must account for uptime.
	check(0, time.Time{})
	activate(true)
	send(session, nil)
	check(0, time.Time{})
	b.PublicIp = []*v1.TelemetryPublicIP{ip}
	send("wrong", monitoring.ErrTelemetrySession)
	check(0, time.Time{})
	ip.Uptime.SampledAt = now.Add(6 * time.Minute)
	send(session, v1.ErrTelemetryPayload)
	check(0, time.Time{})
	ip.Uptime.SampledAt = sampled
	send(session, nil)
	first := *ip.Uptime.Seconds
	check(first, sampled)
	checkHistory(first, sampled)
	zero := 0.0
	ip.Uptime.Seconds = &zero
	ip.Uptime.SampledAt = sampled.Add(time.Second)
	send(session, nil)
	check(first, sampled) // Same group sequence with a different payload.
	checkHistory(first, sampled)
	ip.Sequence++
	send(session, nil)
	check(0, sampled.Add(time.Second))
	ip.Sequence++
	ip.Uptime.SampledAt = sampled.Add(-time.Second)
	ip.Uptime.Seconds = &first
	send(session, nil)
	check(0, sampled.Add(time.Second))
	ip.Sequence++
	ip.Uptime.Seconds = nil
	ip.Uptime.Error = "uptime_unavailable"
	ip.Uptime.SampledAt = sampled.Add(30 * time.Second)
	send(session, nil)
	check(0, sampled.Add(time.Second))
	checkHistory(0, sampled.Add(time.Second))
	activate(false)
	b.PublicIp = []*v1.TelemetryPublicIP{}
	fast.UptimeSeconds = &first
	fast.Sequence++
	fast.SampledAt = now.Add(2 * time.Second)
	send(session, nil)
	check(0, sampled.Add(time.Second))
	now = now.Add(11 * time.Minute)
	fast.SampledAt = now
	fast.Sequence++
	send(session, nil)
	check(first, now)
}
