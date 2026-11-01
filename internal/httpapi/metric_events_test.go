package httpapi

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/realtime"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func nextSSE(t *testing.T, r *bufio.Reader) (string, string) {
	t.Helper()
	type frame struct {
		kind, data string
		err        error
	}
	result := make(chan frame, 1)
	go func() {
		var f frame
		for {
			line, err := r.ReadString('\n')
			if err != nil {
				f.err = err
				result <- f
				return
			}
			if line == "\n" {
				result <- f
				return
			}
			if strings.HasPrefix(line, "event: ") {
				f.kind = strings.TrimSpace(strings.TrimPrefix(line, "event: "))
			}
			if strings.HasPrefix(line, "data: ") {
				f.data = strings.TrimSpace(strings.TrimPrefix(line, "data: "))
			}
		}
	}()
	select {
	case f := <-result:
		if f.err != nil {
			t.Fatal(f.err)
		}
		return f.kind, f.data
	case <-time.After(3 * time.Second):
		t.Fatal("event did not arrive within 3 seconds")
		return "", ""
	}
}

func metricFrame(t *testing.T, r *bufio.Reader) MetricFrame {
	t.Helper()
	kind, data := nextSSE(t, r)
	if kind != "metrics" {
		t.Fatalf("unexpected frame %s: %s", kind, data)
	}
	var f MetricFrame
	if err := json.Unmarshal([]byte(data), &f); err != nil {
		t.Fatal(err)
	}
	return f
}

func TestMetricStreamWSSDeltaReconnectAndScope(t *testing.T) {
	f := setup(t, "admin")
	node, key := f.enroll()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "wss"+strings.TrimPrefix(f.server.URL, "https")+"/api/v1/agents/ws", &websocket.DialOptions{HTTPClient: f.server.Client(), HTTPHeader: http.Header{"Authorization": []string{"Bearer " + f.token(node, key)}}})
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	send(tWriter{t, c}, v1.Message("system.hello", node, auth.Random(), v1.Hello{ProtocolVersions: []string{v1.Version}, Capabilities: []string{"node.metrics.v2"}}))
	receive(t, c)
	res := f.request("GET", "/api/v1/metrics/events?node="+node, nil, true)
	defer res.Body.Close()
	r := bufio.NewReader(res.Body)
	initial := metricFrame(t, r)
	if !initial.Reset || len(initial.Items) != 1 {
		t.Fatal("missing scoped snapshot")
	}
	usage := 25.0
	at := time.Now().UTC().Truncate(time.Minute)
	m := v1.NodeMetrics{SampledAt: at, IntervalSeconds: 1, CPU: &v1.CPUMetrics{LogicalCPUs: 2, UsagePercent: &usage}, Interfaces: []*v1.InterfaceMetrics{}, Errors: []string{"memory_unavailable", "disk_unavailable", "load_unavailable", "uptime_unavailable"}}
	send(tWriter{t, c}, v1.Message("node.metrics", node, auth.Random(), m))
	delta := metricFrame(t, r)
	if delta.Reset || delta.Items[node].Sequence != 1 || len(delta.Items[node].Points) != 1 || delta.Items[node].Latest == nil {
		t.Fatalf("missing pushed sample: %+v", delta)
	}
	m.SampledAt = at.Add(time.Second)
	other := m
	other.SampledAt = at.Add(2 * time.Second)
	send(tWriter{t, c}, v1.Message("node.metrics_batch", node, auth.Random(), v1.NodeMetricsBatch{Samples: []*v1.NodeMetrics{&m, &other}}))
	delta = metricFrame(t, r)
	if delta.Items[node].Reset || len(delta.Items[node].Points) != 2 || delta.Items[node].Sequence != 3 {
		t.Fatal("batch was reduced to latest or replayed")
	}
	res.Body.Close()
	res = f.request("GET", "/api/v1/metrics/events?node="+node, nil, true)
	defer res.Body.Close()
	full := metricFrame(t, bufio.NewReader(res.Body))
	if !full.Reset || len(full.Items[node].Points) != 3 || full.Items[node].Points[2].Sequence != 3 || full.Items[node].Points[0].Values["cpu"] != 25 {
		t.Fatal("reconnect did not restore raw samples")
	}
	list := f.request("GET", "/api/v1/metrics/events?through="+node, nil, true)
	defer list.Body.Close()
	summary := metricFrame(t, bufio.NewReader(list.Body))
	if len(summary.Items[node].Points) != 0 || summary.Items[node].Latest.CPU == nil || summary.Items[node].Latest.Interfaces == nil {
		t.Fatal("invalid summary projection")
	}
	for _, path := range []string{"?node=" + node + "&node=" + node, "?node=" + node + "&through=x", "?token=secret", "?through=", "?node=%ZZ"} {
		expectStatus(t, f.request("GET", "/api/v1/metrics/events"+path, nil, true), 400)
	}
	expectStatus(t, f.request("GET", "/api/v1/metrics/events?node=missing", nil, true), 404)
	expectStatus(t, f.request("GET", "/api/v1/metrics/events?node="+node, nil, false), 401)
}

func TestBusinessEventsCommitAndSessionRevocation(t *testing.T) {
	f := setup(t, "admin")
	node, _ := f.enroll()
	res := f.request("GET", "/api/v1/events", nil, true)
	defer res.Body.Close()
	r := bufio.NewReader(res.Body)
	nextSSE(t, r)
	kind, _ := nextSSE(t, r)
	if kind != "ready" {
		t.Fatal("missing recovery barrier")
	}
	if err := f.store.Online(context.Background(), node, v1.Hello{OS: "linux"}); err != nil {
		t.Fatal(err)
	}
	kind, data := nextSSE(t, r)
	var c ResourceChange
	json.Unmarshal([]byte(data), &c)
	if kind != "change" || c.Node == nil || c.Node.State != "online" {
		t.Fatalf("committed node state not pushed: %s", data)
	}
	if err := f.users.Logout(context.Background(), f.cookie.Value); err != nil {
		t.Fatal(err)
	}
	f.store.Events().Publish(realtime.Change{Kind: "tasks", NodeID: node})
	kind, _ = nextSSE(t, r)
	if kind != "closed" {
		t.Fatal("revoked session received business data")
	}
}

func TestDisabledStreamsAndNotificationWrites(t *testing.T) {
	f := setup(t, "admin")
	enableSettings(t, f)
	node, _ := f.enroll()
	if err := f.store.Online(context.Background(), node, v1.Hello{}); err != nil {
		t.Fatal(err)
	}
	res := f.request("GET", "/api/v1/events", nil, true)
	defer res.Body.Close()
	r := bufio.NewReader(res.Body)
	nextSSE(t, r)
	nextSSE(t, r)
	if err := f.store.Offline(context.Background(), node); err != nil {
		t.Fatal(err)
	}
	found := false
	for range 2 {
		kind, data := nextSSE(t, r)
		if kind == "notifications" {
			var delta NotificationDelta
			json.Unmarshal([]byte(data), &delta)
			found = len(delta.Items) == 1
		}
	}
	if !found {
		t.Fatal("offline notification not pushed")
	}
	settings, err := f.store.Settings(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	settings.SSE = false
	if err = f.store.SaveSettings(context.Background(), "user", settings); err != nil {
		t.Fatal(err)
	}
	kind, _ := nextSSE(t, r)
	if kind != "closed" {
		t.Fatal("disabled stream remains open")
	}
	expectStatus(t, f.request("GET", "/api/v1/metrics/events?node="+node, nil, true), 409)
	expectStatus(t, f.request("GET", "/api/v1/events", nil, true), 409)
}
