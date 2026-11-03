package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/monitoring"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func TestRetiredAgentSettingsRoutesAreGone(t *testing.T) {
	f := setup(t, "admin")
	node, _ := f.enroll()
	for _, method := range []string{"GET", "PUT"} {
		for _, suffix := range []string{"/settings", "/settings/status"} {
			expectStatus(t, f.request(method, "/api/v1/nodes/"+node+suffix, map[string]any{}, true), 404)
		}
	}
	defaults := decodeResponse[v1.TelemetrySettings](t, f.request("GET", "/api/v1/nodes/"+node+"/telemetry-settings", nil, true), 200)
	if defaults != v1.DefaultTelemetrySettings() {
		t.Fatal(defaults)
	}
}

func TestRetiredMonitoringCannotNegotiateOrIngest(t *testing.T) {
	for _, kind := range []string{"node.metrics", "node.metrics_batch", "node.settings_result"} {
		t.Run(kind, func(t *testing.T) {
			f := setup(t, "admin")
			node, key := f.enroll()
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			c, _, err := websocket.Dial(ctx, "wss"+strings.TrimPrefix(f.server.URL, "https")+"/api/v1/agents/ws", &websocket.DialOptions{HTTPClient: f.server.Client(), HTTPHeader: http.Header{"Authorization": {"Bearer " + f.token(node, key)}}})
			if err != nil {
				t.Fatal(err)
			}
			defer c.CloseNow()
			send(tWriter{t, c}, v1.Message("system.hello", node, auth.Random(), v1.Hello{ProtocolVersions: []string{v1.Version}, Capabilities: []string{"node.metrics.v1", "node.metrics.v2", "node.settings.v2", "node.settings.live.v1"}}))
			ack := receive(t, c)
			var fields map[string]json.RawMessage
			if err := json.Unmarshal(ack.Payload, &fields); err != nil {
				t.Fatal(err)
			}
			for _, key := range []string{"metrics_version", "collection_settings", "settings_version", "node_settings", "host_metrics_version", "filesystems_version"} {
				if fields[key] != nil {
					t.Fatal("retired capability negotiated", key)
				}
			}
			send(tWriter{t, c}, v1.Message(kind, node, auth.Random(), map[string]any{}))
			if _, _, err = c.Read(ctx); err == nil || ctx.Err() != nil {
				t.Fatal("retired message not rejected promptly", err)
			}
			snapshot, err := f.gate.ReadMetrics(node, monitoring.Cursor{}, false)
			if err != nil || snapshot.Telemetry != nil {
				t.Fatal("retired payload produced telemetry", err)
			}
		})
	}
}
