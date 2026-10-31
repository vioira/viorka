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
