package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/vioira/viorka/internal/monitoring"
	"github.com/vioira/viorka/internal/realtime"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func setTCPHistoryTargets(t *testing.T, f *fixture, node string, targets ...string) {
	t.Helper()
	ctx := context.Background()
	cfg, err := f.store.TelemetrySettings(ctx, node)
	if err != nil {
		t.Fatal(err)
	}
	cfg.TcpProbe = &v1.TelemetryTCPProbeSettings{Targets: append([]string{}, targets...)}
	if _, err := f.store.SaveTelemetrySettings(ctx, f.session.User.ID, node, cfg); err != nil {
		t.Fatal(err)
	}
}

func TestTCPHistoryAPI(t *testing.T) {
	f := setup(t, "admin")
	node, _ := f.enroll()
	setTCPHistoryTargets(t, f, node, "example.com:443")
	now := time.Now().UTC()
	at := now.Add(-time.Minute)
	ms := 42.0
	point := monitoring.TCPHistoryPoint{BucketStart: at.Truncate(time.Minute).Unix(), TelemetryTCPProbeBatch: v1.TelemetryTCPProbeBatch{SampledAt: at, Targets: []*v1.TelemetryTCPProbe{{Target: "example.com:443", Ping: ms, Loss: 0}}}}
	if err := f.store.SaveTelemetryHistory(context.Background(), []monitoring.NodeHistory{{Node: node, TCPProbes: []monitoring.TCPHistoryPoint{point}}}, now); err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/nodes/" + node + "/tcp-probes/history"
	h := decodeResponse[monitoring.TCPHistory](t, f.request("GET", path, nil, true), 200)
	if h.PeriodSeconds != 60 || len(h.Points) != 1 || h.Points[0].Targets[0].Ping != 42 {
		t.Fatal(h)
	}
	// A port change takes effect even if every stored sample predates the edit.
	setTCPHistoryTargets(t, f, node, "example.com:8443")
	for _, query := range []string{"", "?target=example.com:443", "?target=example.com:8443"} {
		result := decodeResponse[monitoring.TCPHistory](t, f.request("GET", path+query, nil, true), 200)
		if result.Points == nil || len(result.Points) != 0 {
			t.Fatalf("retired data for %s: %+v", query, result)
		}
	}
	for _, tc := range []struct {
		suffix string
		status int
		auth   bool
	}{
		{"", 401, false}, {"?range=7d", 200, true}, {"?range=24h", 200, true}, {"?range=6h", 200, true},
		{"?range=7d&period_seconds=60", 400, true}, {"?period_seconds=0", 400, true}, {"?range=bad", 400, true},
		{"?start=bad&end=bad", 400, true}, {"?target=127.0.0.1:80", 400, true}, {"?unknown=1", 400, true}, {"?range=1h&range=7d", 400, true},
		{"?target=example.net:443", 200, true},
	} {
		res := f.request("GET", path+tc.suffix, nil, tc.auth)
		if res.StatusCode != tc.status {
			t.Errorf("%s: %d %s", tc.suffix, res.StatusCode, read(res))
		}
		res.Body.Close()
	}
	res := f.request("GET", "/api/v1/nodes/missing/tcp-probes/history", nil, true)
	if res.StatusCode != 404 {
		t.Fatal(res.StatusCode)
	}
	res.Body.Close()
	// An authenticated reader receives a real dependency failure, not an empty success.
	handler := NewRouter(Dependencies{Auth: f.users, Nodes: f.store})
	req := httptest.NewRequest("GET", path, nil)
	req.AddCookie(f.cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatal(rec.Code, rec.Body.String())
	}
}

func TestTCPHistoryViewerAccess(t *testing.T) {
	f := setup(t, "viewer")
	// Missing resource is checked after authentication for read-only users too.
	res := f.request("GET", "/api/v1/nodes/missing/tcp-probes/history", nil, true)
	defer res.Body.Close()
	if res.StatusCode != 404 {
		t.Fatal(res.StatusCode)
	}
}

// Count historical reads separately from node existence checks.
type countedTCPHistory struct {
	monitoring.TCPHistoryRepository
	reads int
}

func (r *countedTCPHistory) TCPProbeHistory(ctx context.Context, node string, targets []string, start, end, now time.Time, period int) (monitoring.TCPHistory, error) {
	r.reads++
	return r.TCPHistoryRepository.TCPProbeHistory(ctx, node, targets, start, end, now, period)
}
func TestBrowserTCPHistoryIncremental(t *testing.T) {
	f := setup(t, "admin")
	node, _ := f.enroll()
	setTCPHistoryTargets(t, f, node, "example.com:443")
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	repo := &countedTCPHistory{TCPHistoryRepository: f.store}
	h := browserTCPHistory{a: &api{Dependencies: Dependencies{Nodes: f.store, TCPHistory: repo}}}
	sub := f.store.Events().Subscribe(func(c realtime.Change) bool { return c.Kind == "tcp_history" })
	defer sub.Close()
	save := func(at time.Time, ms float64) {
		t.Helper()
		p := monitoring.TCPHistoryPoint{BucketStart: at.Truncate(time.Minute).Unix(), TelemetryTCPProbeBatch: v1.TelemetryTCPProbeBatch{SampledAt: at, Targets: []*v1.TelemetryTCPProbe{{Target: "example.com:443", Ping: ms, Loss: 0}}}}
		if err := f.store.SaveTelemetryHistory(ctx, []monitoring.NodeHistory{{Node: node, TCPProbes: []monitoring.TCPHistoryPoint{p}}}, now); err != nil {
			t.Fatal(err)
		}
	}
	save(now.Add(-2*time.Minute), 42)
	sub.Drain()
	if !h.set(&browserTCPHistorySubscription{Node: node, Range: "1h", Generation: 1}) {
		t.Fatal("subscription")
	}
	var frames []browserTCPHistoryFrame
	send := func(f browserFrame) bool {
		if f.Event != "tcp_history" {
			t.Fatalf("unexpected frame: %+v", f)
		}
		frames = append(frames, f.Data.(browserTCPHistoryFrame))
		return true
	}
	h.send(ctx, send, now)
	if repo.reads != 1 || len(frames) != 1 || !frames[0].Reset || len(frames[0].Points) != 1 {
		t.Fatal(repo.reads, frames)
	}
	at := now.Add(-time.Second)
	save(at, 80)
	changes, reset := sub.Drain()
	if reset || len(changes) != 1 {
		t.Fatal(changes, reset)
	}
	for _, c := range changes {
		h.change(c)
	}
	h.send(ctx, send, now.Add(time.Second))
	if repo.reads != 1 || len(frames) != 2 || frames[1].Reset || len(frames[1].Points) != 1 || frames[1].Points[0].Targets[0].Ping != 80 {
		t.Fatal(repo.reads, frames)
	}
	save(at, 99)
	changes, _ = sub.Drain()
	if len(changes) != 0 {
		t.Fatal("duplicate published", changes)
	}
	// Expiration is an empty delta; historical reads remain unchanged.
	h.send(ctx, send, now.Add(2*time.Hour))
	if repo.reads != 1 || len(frames) != 3 || len(frames[2].Points) != 0 || len(frames[2].Targets) != 0 {
		t.Fatal(repo.reads, frames)
	}
	h.set(&browserTCPHistorySubscription{Node: node, Range: "6h", Generation: 2})
	h.send(ctx, send, now)
	if repo.reads != 2 || !frames[3].Reset || frames[3].PeriodSeconds != 300 {
		t.Fatal(repo.reads, frames)
	}
	h.set(nil)
	if h.due(now.Add(time.Hour)) {
		t.Fatal("unsubscribed history still active")
	}
}

func TestBrowserTCPHistorySocket(t *testing.T) {
	f := setup(t, "admin")
	node, _ := f.enroll()
	setTCPHistoryTargets(t, f, node, "example.com:443")
	c := browserTestSocket(t, f)
	browserSend(t, c, browserMessage{Type: "subscribe", Enabled: true, TCPHistory: &browserTCPHistorySubscription{Node: node, Range: "1h", Generation: 7}})
	initial := browserReceive(t, c, "tcp_history", "")
	decode := func(f browserFrame) browserTCPHistoryFrame {
		t.Helper()
		b, err := json.Marshal(f.Data)
		if err != nil {
			t.Fatal(err)
		}
		var data browserTCPHistoryFrame
		if err = json.Unmarshal(b, &data); err != nil {
			t.Fatal(err)
		}
		return data
	}
	if data := decode(initial); initial.Generation != 7 || !data.Reset || len(data.Points) != 0 {
		t.Fatal(initial)
	}
	at := time.Now().UTC().Truncate(time.Minute).Add(-30 * time.Second)
	ms := 42.0
	p := monitoring.TCPHistoryPoint{BucketStart: at.Truncate(time.Minute).Unix(), TelemetryTCPProbeBatch: v1.TelemetryTCPProbeBatch{SampledAt: at, Targets: []*v1.TelemetryTCPProbe{{Target: "example.com:443", Ping: ms, Loss: 0}}}}
	save := func() {
		t.Helper()
		if err := f.store.SaveTelemetryHistory(context.Background(), []monitoring.NodeHistory{{Node: node, TCPProbes: []monitoring.TCPHistoryPoint{p}}}, time.Now()); err != nil {
			t.Fatal(err)
		}
	}
	save()
	// First target changes the target set and obtains a fresh snapshot.
	first := decode(browserReceive(t, c, "tcp_history", ""))
	if !first.Reset || len(first.Points) != 1 {
		t.Fatal(first)
	}
	p.SampledAt = p.SampledAt.Add(100 * time.Millisecond)
	p.Targets[0].Ping = 80
	save()
	delta := decode(browserReceive(t, c, "tcp_history", ""))
	if delta.Reset || len(delta.Points) != 1 || delta.Points[0].Targets[0].Ping != 80 {
		t.Fatal(delta)
	}
	// Follow the inherited configuration while the subscription stays open.
	ctx := context.Background()
	if err := f.store.InitSettings(ctx, f.server.URL); err != nil {
		t.Fatal(err)
	}
	cfg, err := f.store.TelemetrySettings(ctx, node)
	if err != nil {
		t.Fatal(err)
	}
	cfg.TcpProbe = nil
	if _, err := f.store.SaveTelemetrySettings(ctx, f.session.User.ID, node, cfg); err != nil {
		t.Fatal(err)
	}
	cleared := decode(browserReceive(t, c, "tcp_history", ""))
	if !cleared.Reset || len(cleared.Targets) != 0 || len(cleared.Points) != 0 {
		t.Fatal("subscription retained disabled targets", cleared)
	}
	global, err := f.store.Settings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	global.TCPProbeTargets = []string{"example.com:8443"}
	if err := f.store.SaveSettings(ctx, f.session.User.ID, global); err != nil {
		t.Fatal(err)
	}
	changed := decode(browserReceive(t, c, "tcp_history", ""))
	if !changed.Reset || len(changed.Points) != 0 {
		t.Fatal("configuration change should reset before the first new sample", changed)
	}
	p.Targets = append(p.Targets, &v1.TelemetryTCPProbe{Target: "example.com:8443", Ping: 13})
	for i := range 2 {
		p.SampledAt = p.SampledAt.Add(time.Millisecond)
		p.BucketStart = p.SampledAt.Truncate(time.Minute).Unix()
		save()
		frame := decode(browserReceive(t, c, "tcp_history", ""))
		if frame.Reset != (i == 0) || !slices.Equal(frame.Targets, global.TCPProbeTargets) || len(frame.Points) != 1 || len(frame.Points[0].Targets) != 1 || frame.Points[0].Targets[0].Target != global.TCPProbeTargets[0] {
			t.Fatal("unexpected targets after port change", frame)
		}
	}
	browserSend(t, c, browserMessage{Type: "subscribe", Enabled: false, TCPHistory: &browserTCPHistorySubscription{Node: node, Range: "6h", Generation: 8}})
	manual := browserReceive(t, c, "tcp_history", "")
	if data := decode(manual); manual.Generation != 8 || !data.Reset || data.PeriodSeconds != 300 {
		t.Fatal(manual)
	}
}

func TestBrowserMetricsFiltersCachedTCPProbes(t *testing.T) {
	f := setupConfigured(t, "admin", true)
	node, _ := f.enroll()
	setTCPHistoryTargets(t, f, node, "example.com:8443")
	ctx := context.Background()
	now := time.Now().UTC()
	session := strings.Repeat("a", 64)
	ingress := monitoring.NewTelemetryIngress(f.recorder)
	f.gate.ConfigureTelemetry(ingress)
	if err := ingress.Activate(node, session, "g", now.Add(time.Hour), v1.DefaultTelemetrySettings(), now, monitoring.TelemetryCapabilities{TCPProbe: true}); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile("../../api/agent/v1/examples/node.metrics.v3.tcp_probe.json")
	if err != nil {
		t.Fatal(err)
	}
	var example struct{ Payload v1.TelemetryBatch }
	if err := json.Unmarshal(raw, &example); err != nil {
		t.Fatal(err)
	}
	b := example.Payload
	b.NodeID = node
	b.Fast[0].SampledAt = now
	b.Full[0].SampledAt = now
	probes := b.Full[0].TcpProbes
	probes.SampledAt = now
	probes.Targets = append(probes.Targets, &v1.TelemetryTCPProbe{Target: "example.com:8443", Ping: 19})
	raw, err = json.Marshal(b)
	if err != nil {
		t.Fatal(err)
	}
	if receipt, err := ingress.Receive(ctx, node, session, "g", raw, true, now); err != nil || receipt.State != "accepted" {
		t.Fatal(receipt, err)
	}
	c := browserTestSocket(t, f)
	read := func(generation uint64) *v1.TelemetryTCPProbeBatch {
		t.Helper()
		browserSend(t, c, browserMessage{Type: "subscribe", Node: node, Scope: "node=" + node + "&view=history", Enabled: true, Generation: generation})
		frame := browserReceive(t, c, "metrics", "")
		raw, err := json.Marshal(frame.Data)
		if err != nil {
			t.Fatal(err)
		}
		var data MetricFrame
		if err := json.Unmarshal(raw, &data); err != nil {
			t.Fatal(err)
		}
		snap := data.Items[node].Telemetry
		if snap == nil || snap.Full == nil {
			t.Fatal(data)
		}
		return snap.Full.TcpProbes
	}
	if got := read(1); got == nil || len(got.Targets) != 1 || got.Targets[0].Target != "example.com:8443" {
		t.Fatal("retired live probe present or current sample lost", got)
	}
	setTCPHistoryTargets(t, f, node)
	if got := read(2); got != nil {
		t.Fatal("empty config returned cached probes", got)
	}
}
