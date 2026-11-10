package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
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
	browserSend(t, observer, browserMessage{Type: "subscribe", Node: node, Enabled: true, Generation: 1})
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
