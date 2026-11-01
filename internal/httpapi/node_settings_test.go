package httpapi

import (
	"context"
	"github.com/coder/websocket"
	"github.com/vioira/viorka/internal/auth"
	v1 "github.com/vioira/viorka/protocol/v1"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestNodeSettingsAPIAndNegotiation(t *testing.T) {
	f := setup(t, "admin")
	node, key := f.enroll()
	other, _ := f.enroll()
	path := "/api/v1/nodes/" + node + "/settings"
	original := decodeResponse[v1.NodeSettings](t, f.request("GET", path, nil, true), 200)
	if original.CollectionSeconds != 0 || original.ReportSeconds != 60 || original.WssReportSeconds != 2 || original.ConnectionMode != "wss" {
		t.Fatalf("defaults %+v", original)
	}
	v := original
	v.CollectionSeconds = 10
	v.ReportSeconds = 120
	v.WssReportSeconds = 1
	saved := decodeResponse[v1.NodeSettings](t, f.request("PUT", path, v, true), 200)
	if saved.Revision != original.Revision+1 {
		t.Fatal("revision not increased")
	}
	expectStatus(t, f.request("PUT", path, v, true), 409)
	expectStatus(t, f.request("PUT", path, saved, false), 401)
	bad := saved
	bad.ConnectionMode = "http_post"
	expectStatus(t, f.request("PUT", path, bad, true), 400)
	bad = saved
	bad.CollectionSeconds = 301
	expectStatus(t, f.request("PUT", path, bad, true), 400)
	bad = saved
	bad.ReportSeconds = 29
	expectStatus(t, f.request("PUT", path, bad, true), 400)
	bad = saved
	bad.WssReportSeconds = 9
	expectStatus(t, f.request("PUT", path, bad, true), 400)
	expectStatus(t, f.request("GET", "/api/v1/nodes/missing/settings", nil, true), 404)
	unchanged := decodeResponse[v1.NodeSettings](t, f.request("GET", "/api/v1/nodes/"+other+"/settings", nil, true), 200)
	if unchanged != original {
		t.Fatal("other node settings modified")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "wss"+strings.TrimPrefix(f.server.URL, "https")+"/api/v1/agents/ws", &websocket.DialOptions{HTTPClient: f.server.Client(), HTTPHeader: http.Header{"Authorization": []string{"Bearer " + f.token(node, key)}}})
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	send(tWriter{t, c}, v1.Message("system.hello", node, auth.Random(), v1.Hello{ProtocolVersions: []string{v1.Version}, Capabilities: []string{"node.settings.v2"}, OS: "linux", Arch: "amd64"}))
	ack := receive(t, c)
	var h v1.HelloAck
	if v1.Decode(ack.Payload, &h) != nil || h.CollectionSettings == nil || *h.CollectionSettings != saved {
		t.Fatalf("settings not delivered: %+v", h)
	}
	saved.ReportSeconds = 180
	expectStatus(t, f.request("PUT", path, saved, true), 200)
	if _, _, err = c.Read(ctx); err == nil {
		t.Fatal("save did not trigger management reconnect")
	}
}
func TestNodeSettingsViewerCannotWrite(t *testing.T) {
	f := setup(t, "viewer")
	v := v1.NodeSettings{Revision: 1, CollectionSeconds: 30, ReportSeconds: 300, WssReportSeconds: 30, ConnectionMode: "wss"}
	expectStatus(t, f.request("PUT", "/api/v1/nodes/any/settings", v, true), 403)
}

func TestLiveNodeSettingsReceipts(t *testing.T) {
	f := setup(t, "admin")
	node, key := f.enroll()
	path := "/api/v1/nodes/" + node + "/settings"
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "wss"+strings.TrimPrefix(f.server.URL, "https")+"/api/v1/agents/ws", &websocket.DialOptions{HTTPClient: f.server.Client(), HTTPHeader: http.Header{"Authorization": []string{"Bearer " + f.token(node, key)}}})
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	send(tWriter{t, c}, v1.Message("system.hello", node, auth.Random(), v1.Hello{ProtocolVersions: []string{v1.Version}, Capabilities: []string{"node.settings.live.v1"}, OS: "linux", Arch: "amd64"}))
	hello := receive(t, c)
	var ack v1.HelloAck
	if v1.Decode(hello.Payload, &ack) != nil || ack.SettingsVersion == nil || *ack.SettingsVersion != 1 || ack.CollectionSettings == nil {
		t.Fatal("missing live settings negotiation")
	}
	confirm := func(id string, revision uint64, state, code string) {
		result := v1.NodeSettingsResult{Revision: revision, AppliedRevision: revision, State: state, ErrorCode: code}
		if state == "failed" {
			result.AppliedRevision = revision - 1
		}
		msg := v1.Message("node.settings_result", node, auth.Random(), result)
		msg.CorrelationID = id
		send(tWriter{t, c}, msg)
	}
	waitStatus := func(state string) {
		t.Helper()
		deadline := time.Now().Add(2 * time.Second)
		for {
			status := decodeResponse[NodeSettingsStatus](t, f.request("GET", path+"/status", nil, true), 200)
			if status.State == state {
				return
			}
			if time.Now().After(deadline) {
				t.Fatalf("expected %s got %+v", state, status)
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
	waitStatus("pending")
	confirm(hello.MessageID, ack.CollectionSettings.Revision, "applied", "")
	waitStatus("applied")
	next := *ack.CollectionSettings
	next.CollectionSeconds = 4
	saved := decodeResponse[v1.NodeSettings](t, f.request("PUT", path, next, true), 200)
	update := receive(t, c)
	var delivered v1.NodeSettings
	if update.Type != "node.settings" || v1.Decode(update.Payload, &delivered) != nil || delivered != saved {
		t.Fatal("hot update not delivered", update)
	}
	waitStatus("pending")
	// Delayed ACK for the handshake must not acknowledge this new revision.
	confirm(hello.MessageID, next.Revision, "applied", "")
	confirm(update.MessageID, saved.Revision, "failed", "persist_failed")
	waitStatus("failed")
	saved.ReportSeconds = 120
	saved = decodeResponse[v1.NodeSettings](t, f.request("PUT", path, saved, true), 200)
	update = receive(t, c)
	confirm(update.MessageID, saved.Revision, "applied", "")
	waitStatus("applied")
	expectStatus(t, f.request("GET", path+"/status", nil, false), 401)
	expectStatus(t, f.request("GET", "/api/v1/nodes/missing/settings/status", nil, true), 404)
}
