package httpapi

import (
	"bufio"
	"context"
	"encoding/json"

	"strings"
	"testing"
	"time"

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
	if kind != "change" || c.Node == nil || c.Node.State != "online" || c.Node.Engines == nil || len(*c.Node.Engines) != 0 {
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

func TestMetricSSEOwnsScopedTelemetryReferences(t *testing.T) {
	f := setup(t, "admin")
	node, _ := f.enroll()
	expectStatus(t, f.request("GET", "/api/v1/metrics/events?node="+node, nil, false), 401)
	if f.gate.TelemetryDemand(node).References != 0 {
		t.Fatal("unauthorized subscription acquired demand")
	}
	first := f.request("GET", "/api/v1/metrics/events?node="+node, nil, true)
	defer first.Body.Close()
	metricFrame(t, bufio.NewReader(first.Body))
	second := f.request("GET", "/api/v1/metrics/events?node="+node, nil, true)
	defer second.Body.Close()
	metricFrame(t, bufio.NewReader(second.Body))
	if f.gate.TelemetryDemand(node).References != 2 {
		t.Fatal("two SSE viewers not counted")
	}
	waitRefs := func(want int) {
		t.Helper()
		timeout := time.NewTimer(2 * time.Second)
		defer timeout.Stop()
		tick := time.NewTicker(10 * time.Millisecond)
		defer tick.Stop()
		for {
			if f.gate.TelemetryDemand(node).References == want {
				return
			}
			select {
			case <-tick.C:
			case <-timeout.C:
				t.Fatalf("references did not reach %d", want)
			}
		}
	}
	first.Body.Close()
	waitRefs(1)
	if !f.gate.TelemetryDemand(node).GraceUntil.IsZero() {
		t.Fatal("one viewer closed all live demand")
	}
	second.Body.Close()
	waitRefs(0)
	state := f.gate.TelemetryDemand(node)
	if !state.GraceUntil.After(time.Now()) || state.GraceUntil.After(time.Now().Add(15*time.Second)) {
		t.Fatal("last viewer did not start bounded grace")
	}
	response := f.request("GET", "/api/v1/nodes/"+node+"/metrics", nil, true)
	expectStatus(t, response, 200)
	if f.gate.TelemetryDemand(node).References != 0 {
		t.Fatal("REST snapshot created realtime demand")
	}
}

func TestListMetricWindowDoesNotSlideAndBusinessChangesStayImmediate(t *testing.T) {
	f := setup(t, "admin")
	node, _ := f.enroll()
	stream := f.request("GET", "/api/v1/metrics/events?through="+node, nil, true)
	defer stream.Body.Close()
	reader := bufio.NewReader(stream.Body)
	kind, _ := nextSSE(t, reader)
	if kind != "metrics" {
		t.Fatal("missing immediate snapshot")
	}
	business := f.request("GET", "/api/v1/events", nil, true)
	defer business.Body.Close()
	businessReader := bufio.NewReader(business.Body)
	nextSSE(t, businessReader)
	nextSSE(t, businessReader)

	// Capture one frame without introducing a shorter read timeout than the window.
	frames := make(chan string, 1)
	go func() {
		var frame strings.Builder
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				return
			}
			frame.WriteString(line)
			if line == "\n" {
				frames <- frame.String()
				return
			}
		}
	}()
	start := time.Now()
	f.store.Events().Publish(realtime.Change{Kind: "metrics", NodeID: node})
	// A real node update must reach the business stream inside the metric window.
	if err := f.store.Online(context.Background(), node, v1.Hello{OS: "linux"}); err != nil {
		t.Fatal(err)
	}
	kind, data := nextSSE(t, businessReader)
	if kind != "change" || !strings.Contains(data, `"state":"online"`) {
		t.Fatal(kind, data)
	}

	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	deadline := time.NewTimer(7 * time.Second)
	defer deadline.Stop()
	for {
		select {
		case <-ticker.C:
			f.store.Events().Publish(realtime.Change{Kind: "metrics", NodeID: node})
		case frame := <-frames:
			elapsed := time.Since(start)
			if elapsed < 4900*time.Millisecond || !strings.Contains(frame, "event: metrics") {
				t.Fatalf("early or invalid frame after %s: %s", elapsed, frame)
			}
			var summary MetricSummaryFrame
			for _, line := range strings.Split(frame, "\n") {
				if strings.HasPrefix(line, "data: ") {
					if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &summary); err != nil {
						t.Fatal(err)
					}
				}
			}
			if summary.Reset || len(summary.Items) != 1 {
				t.Fatal("changes did not coalesce into one delta", summary)
			}
			return
		case <-deadline.C:
			t.Fatal("continuous updates postponed the five-second window")
		}
	}
}

func TestListMetricAccessRevocationBypassesBatchWindow(t *testing.T) {
	f := setup(t, "admin")
	node, _ := f.enroll()
	stream := f.request("GET", "/api/v1/metrics/events?through="+node, nil, true)
	defer stream.Body.Close()
	reader := bufio.NewReader(stream.Body)
	nextSSE(t, reader)
	f.store.Events().Publish(realtime.Change{Kind: "metrics", NodeID: node})
	if err := f.users.Logout(context.Background(), f.cookie.Value); err != nil {
		t.Fatal(err)
	}
	kind, _ := nextSSE(t, reader)
	if kind != "closed" {
		t.Fatal("revocation waited for batched metrics", kind)
	}
}
