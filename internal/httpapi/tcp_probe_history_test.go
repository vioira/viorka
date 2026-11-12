package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/vioira/viorka/internal/monitoring"
	"github.com/vioira/viorka/internal/realtime"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func TestTCPHistoryAPI(t *testing.T) {
	f := setup(t, "admin")
	node, _ := f.enroll()
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

func (r *countedTCPHistory) TCPProbeHistory(ctx context.Context, node, target string, start, end, now time.Time, period int) (monitoring.TCPHistory, error) {
	r.reads++
	return r.TCPHistoryRepository.TCPProbeHistory(ctx, node, target, start, end, now, period)
}
func TestBrowserTCPHistoryIncremental(t *testing.T) {
	f := setup(t, "admin")
	node, _ := f.enroll()
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
	at := time.Now().UTC().Add(-time.Second)
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
	browserSend(t, c, browserMessage{Type: "subscribe", Enabled: false, TCPHistory: &browserTCPHistorySubscription{Node: node, Range: "6h", Generation: 8}})
	manual := browserReceive(t, c, "tcp_history", "")
	if data := decode(manual); manual.Generation != 8 || !data.Reset || data.PeriodSeconds != 300 {
		t.Fatal(manual)
	}
}
