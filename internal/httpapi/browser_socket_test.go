package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/vioira/viorka/internal/realtime"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func browserTestSocket(t *testing.T, f *fixture) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "wss"+strings.TrimPrefix(f.server.URL, "https")+"/api/v1/ws", &websocket.DialOptions{HTTPClient: f.server.Client(), HTTPHeader: http.Header{"Origin": {f.server.URL}, "Cookie": {f.cookie.String()}}, Subprotocols: []string{"viorka.browser.v1"}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.CloseNow() })
	browserSend(t, conn, browserMessage{Type: "hello", CSRF: f.session.CSRF, Enabled: true})
	browserReceive(t, conn, "ready", "")
	return conn
}
func browserSend(t *testing.T, c *websocket.Conn, m browserMessage) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	b, _ := json.Marshal(m)
	if err := c.Write(ctx, websocket.MessageText, b); err != nil {
		t.Fatal(err)
	}
}
func browserReceive(t *testing.T, c *websocket.Conn, event, id string) browserFrame {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	for {
		_, b, err := c.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var frame browserFrame
		if err = json.Unmarshal(b, &frame); err != nil {
			t.Fatal(err)
		}
		if (id != "" && frame.ID == id) || (event != "" && frame.Event == event) {
			return frame
		}
	}
}
func TestBrowserSocketRequestsAndMetricSwitch(t *testing.T) {
	f := setup(t, "admin")
	e, err := f.agents.CreateEnrollment(context.Background(), f.session.User.ID, "browser node", "vps")
	if err != nil {
		t.Fatal(err)
	}
	c := browserTestSocket(t, f)
	browserSend(t, c, browserMessage{Type: "request", ID: "read", Method: "getNode", Params: browserParams{ID: e.ID}})
	if frame := browserReceive(t, c, "", "read"); frame.Status != 200 {
		t.Fatalf("read: %+v", frame)
	}
	for i, view := range []string{"overview", "live", "settings"} {
		browserSend(t, c, browserMessage{Type: "subscribe", Node: e.ID, Scope: "node=" + e.ID + "&view=" + view, Generation: uint64(i + 1), Enabled: true})
		frame := browserReceive(t, c, "metrics", "")
		if frame.Generation != uint64(i+1) {
			t.Fatalf("wrong generation: %+v", frame)
		}
	}
	browserSend(t, c, browserMessage{Type: "subscribe", Node: e.ID, Generation: 4, Enabled: false})
	browserSend(t, c, browserMessage{Type: "request", ID: "disabled-read", Method: "getNode", Params: browserParams{ID: e.ID}})
	if frame := browserReceive(t, c, "", "disabled-read"); frame.Status != 200 {
		t.Fatalf("disabled read: %+v", frame)
	}
	browserSend(t, c, browserMessage{Type: "request", ID: "bad", Method: "login"})
	if frame := browserReceive(t, c, "", "bad"); frame.Status != 400 {
		t.Fatalf("allowlist: %+v", frame)
	}
}
func TestBrowserSocketEnforcesCommandRoleAndValidation(t *testing.T) {
	f := setup(t, "viewer")
	c := browserTestSocket(t, f)
	browserSend(t, c, browserMessage{Type: "request", ID: "write", Method: "saveTelemetrySettings", Params: browserParams{ID: "node", Body: json.RawMessage(`{}`)}})
	if frame := browserReceive(t, c, "", "write"); frame.Status != 403 {
		t.Fatalf("role: %+v", frame)
	}
	browserSend(t, c, browserMessage{Type: "request", ID: "path", Method: "getNode", Params: browserParams{ID: "../auth/session"}})
	if frame := browserReceive(t, c, "", "path"); frame.Status != 400 {
		t.Fatalf("path: %+v", frame)
	}
}
func TestBrowserSocketHandshakeBoundaries(t *testing.T) {
	f := setup(t, "admin")
	for _, headers := range []http.Header{{"Origin": {f.server.URL}}, {"Cookie": {f.cookie.String()}}, {"Origin": {"https://untrusted.example"}, "Cookie": {f.cookie.String()}}} {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		c, res, err := websocket.Dial(ctx, "wss"+strings.TrimPrefix(f.server.URL, "https")+"/api/v1/ws", &websocket.DialOptions{HTTPClient: f.server.Client(), HTTPHeader: headers})
		cancel()
		if err == nil {
			c.CloseNow()
			t.Fatal("accepted invalid handshake")
		}
		if res != nil {
			res.Body.Close()
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "wss"+strings.TrimPrefix(f.server.URL, "https")+"/api/v1/ws", &websocket.DialOptions{HTTPClient: f.server.Client(), HTTPHeader: http.Header{"Origin": {f.server.URL}, "Cookie": {f.cookie.String()}}})
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	browserSend(t, c, browserMessage{Type: "hello", CSRF: "wrong"})
	_, _, err = c.Read(ctx)
	if websocket.CloseStatus(err) != websocket.StatusPolicyViolation {
		t.Fatalf("csrf: %v", err)
	}
}

func TestBrowserSocketPushesSettingsAndRejectsStaleWrites(t *testing.T) {
	f := setup(t, "admin")
	node, _ := f.enroll()
	observer := browserTestSocket(t, f)
	browserSend(t, observer, browserMessage{Type: "subscribe", Node: node, Enabled: true, Generation: 1, Changes: []browserChangeSubscription{{Kind: "telemetry_settings", NodeID: node}}})
	browserSend(t, observer, browserMessage{Type: "request", ID: "barrier", Method: "getTelemetrySettings", Params: browserParams{ID: node}})
	if frame := browserReceive(t, observer, "", "barrier"); frame.Status != 200 {
		t.Fatalf("initial: %+v", frame)
	}
	writer := browserTestSocket(t, f)
	body := json.RawMessage(`{"revision":1,"collection_seconds":10,"http_report_seconds":30,"wss_report_seconds":1,"connection_mode":"auto_http_wss"}`)
	browserSend(t, writer, browserMessage{Type: "request", ID: "save", Method: "saveTelemetrySettings", Params: browserParams{ID: node, Body: body}})
	if frame := browserReceive(t, writer, "", "save"); frame.Status != 200 {
		t.Fatalf("save: %+v", frame)
	}
	for {
		frame := browserReceive(t, observer, "change", "")
		data := frame.Data.(map[string]any)
		if data["kind"] != "telemetry_settings" {
			continue
		}
		value, ok := data["telemetry_settings"].(map[string]any)
		if !ok || value["revision"] != float64(2) || value["collection_seconds"] != float64(10) {
			t.Fatalf("missing configuration snapshot: %+v", frame)
		}
		break
	}
	browserSend(t, writer, browserMessage{Type: "request", ID: "stale", Method: "saveTelemetrySettings", Params: browserParams{ID: node, Body: body}})
	if frame := browserReceive(t, writer, "", "stale"); frame.Status != 409 {
		t.Fatalf("stale write: %+v", frame)
	}
}

func TestBrowserSocketRejectsRevokedSession(t *testing.T) {
	f := setup(t, "admin")
	c := browserTestSocket(t, f)
	if err := f.users.Logout(context.Background(), f.cookie.Value); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	for {
		_, _, err := c.Read(ctx)
		if err != nil {
			if ctx.Err() != nil {
				t.Fatal("revoked connection remained open")
			}
			break
		}
	}
}

func TestBrowserChangeSubscriptions(t *testing.T) {
	for _, test := range []struct {
		name           string
		subscriptions  []browserChangeSubscription
		change         realtime.Change
		valid, matches bool
	}{
		{"home", nil, realtime.Change{Kind: "node", NodeID: "a"}, true, false},
		{"matching history", []browserChangeSubscription{{Kind: "history", NodeID: "a"}}, realtime.Change{Kind: "history", NodeID: "a"}, true, true},
		{"other node", []browserChangeSubscription{{Kind: "history", NodeID: "a"}}, realtime.Change{Kind: "history", NodeID: "b"}, true, false},
		{"other kind", []browserChangeSubscription{{Kind: "history", NodeID: "a"}}, realtime.Change{Kind: "node", NodeID: "a"}, true, false},
		{"loaded nodes", []browserChangeSubscription{{Kind: "node", Through: "b"}}, realtime.Change{Kind: "node", NodeID: "a"}, true, true},
		{"outside list", []browserChangeSubscription{{Kind: "node", Through: "b"}}, realtime.Change{Kind: "node", NodeID: "c"}, true, false},
		{"global tasks", []browserChangeSubscription{{Kind: "tasks", All: true}}, realtime.Change{Kind: "tasks", NodeID: "b"}, true, true},
		{"global invalidation", []browserChangeSubscription{{Kind: "tasks", NodeID: "a"}}, realtime.Change{Kind: "tasks"}, true, true},
		{"missing scope", []browserChangeSubscription{{Kind: "node"}}, realtime.Change{}, false, false},
		{"ambiguous scope", []browserChangeSubscription{{Kind: "node", All: true, NodeID: "a"}}, realtime.Change{}, false, false},
		{"invalid kind", []browserChangeSubscription{{Kind: "settings", All: true}}, realtime.Change{}, false, false},
		{"invalid id", []browserChangeSubscription{{Kind: "node", NodeID: "../a"}}, realtime.Change{}, false, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if validBrowserChanges(test.subscriptions) != test.valid {
				t.Fatal("unexpected validation result")
			}
			if test.valid && matchesBrowserChange(test.subscriptions, test.change) != test.matches {
				t.Fatal("unexpected event delivery")
			}
		})
	}
	if validBrowserChanges(make([]browserChangeSubscription, 33)) {
		t.Fatal("accepted oversized subscription")
	}
}

func TestBrowserSocketFiltersUnsubscribedEvents(t *testing.T) {
	f := setup(t, "admin")
	c := browserTestSocket(t, f)
	// A history event marks the queue drain; unrelated node changes must not arrive.
	for _, subscriptions := range [][]browserChangeSubscription{
		{{Kind: "history", NodeID: "barrier"}, {Kind: "node", NodeID: "selected"}},
		{{Kind: "history", NodeID: "barrier"}},
	} {
		browserSend(t, c, browserMessage{Type: "subscribe", Enabled: true, Changes: subscriptions})
		browserReceive(t, c, "updates", "")
		f.store.Events().Publish(realtime.Change{Kind: "node", NodeID: "unsubscribed"})
		f.store.Events().Publish(realtime.Change{Kind: "history", NodeID: "barrier"})
		frame := browserReceive(t, c, "change", "")
		if frame.Data.(map[string]any)["kind"] != "history" {
			t.Fatalf("unexpected change: %+v", frame)
		}
	}
}

func TestBrowserSocketNotificationDeltasAndReset(t *testing.T) {
	f := setup(t, "admin")
	enableSettings(t, f)
	node, _ := f.enroll()
	c := browserTestSocket(t, f)
	nextNotification := func(event string) map[string]any {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		for {
			_, raw, err := c.Read(ctx)
			if err != nil {
				t.Fatal(err)
			}
			var frame browserFrame
			if err := json.Unmarshal(raw, &frame); err != nil {
				t.Fatal(err)
			}
			if frame.Event != "snapshot" && frame.Event != "notifications" {
				continue
			}
			if frame.Event != event {
				t.Fatalf("expected %s, got %+v", event, frame)
			}
			return frame.Data.(map[string]any)
		}
	}
	ctx := context.Background()
	if err := f.store.Online(ctx, node, v1.Hello{}); err != nil {
		t.Fatal(err)
	}
	if err := f.store.Offline(ctx, node); err != nil {
		t.Fatal(err)
	}
	delta := nextNotification("notifications")
	items := delta["items"].([]any)
	if len(items) != 1 || len(delta["removed_ids"].([]any)) != 0 {
		t.Fatalf("addition: %+v", delta)
	}
	id := items[0].(map[string]any)["id"].(string)
	if err := f.store.SetNotificationRead(ctx, f.session.User.ID, id, true); err != nil {
		t.Fatal(err)
	}
	delta = nextNotification("notifications")
	items = delta["items"].([]any)
	if len(items) != 1 || items[0].(map[string]any)["read"] != true {
		t.Fatalf("read delta: %+v", delta)
	}
	f.store.Events().Publish(realtime.Change{Kind: "access", UserID: f.session.User.ID})
	snapshot := nextNotification("snapshot")
	if len(snapshot["items"].([]any)) != 1 {
		t.Fatalf("reset: %+v", snapshot)
	}
	browserReceive(t, c, "ready", "")
	browserSend(t, c, browserMessage{Type: "subscribe", Enabled: false})
	browserReceive(t, c, "updates", "")
	if err := f.store.SetNotificationRead(ctx, f.session.User.ID, id, false); err != nil {
		t.Fatal(err)
	}
	browserSend(t, c, browserMessage{Type: "subscribe", Enabled: true})
	snapshot = nextNotification("snapshot")
	if snapshot["items"].([]any)[0].(map[string]any)["read"] != false {
		t.Fatalf("resume: %+v", snapshot)
	}
	if err := f.store.DeleteNode(ctx, f.session.User.ID, node); err != nil {
		t.Fatal(err)
	}
	delta = nextNotification("notifications")
	if len(delta["items"].([]any)) != 0 || len(delta["removed_ids"].([]any)) != 1 || delta["removed_ids"].([]any)[0] != id {
		t.Fatalf("deletion: %+v", delta)
	}
}
