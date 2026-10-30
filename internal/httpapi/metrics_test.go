package httpapi

import (
	"context"
	"encoding/json"
	"github.com/coder/websocket"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/monitoring"
	v1 "github.com/vioira/viorka/protocol/v1"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestMetricsWSSAndAPI(t *testing.T) {
	f := setup(t, "admin")
	node, key := f.enroll()
	token := f.token(node, key)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "wss"+strings.TrimPrefix(f.server.URL, "https")+"/api/v1/agents/ws", &websocket.DialOptions{HTTPClient: f.server.Client(), HTTPHeader: http.Header{"Authorization": []string{"Bearer " + token}}})
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	send(tWriter{t, c}, v1.Message("system.hello", node, auth.Random(), v1.Hello{AgentVersion: "metrics-test", ProtocolVersions: []string{v1.Version}, Capabilities: []string{"node.metrics.v1"}, OS: "linux", Arch: "amd64"}))
	ack := receive(t, c)
	var h v1.HelloAck
	if v1.Decode(ack.Payload, &h) != nil || h.MetricsVersion == nil || *h.MetricsVersion != 1 {
		t.Fatal("metrics not negotiated")
	}
	usage := 23.5
	m := v1.NodeMetrics{SampledAt: time.Now().UTC(), IntervalSeconds: 30, CPU: &v1.CPUMetrics{LogicalCPUs: 2, UsagePercent: &usage}, Interfaces: []*v1.InterfaceMetrics{}, Errors: []string{"memory_unavailable", "disk_unavailable", "load_unavailable", "uptime_unavailable"}}
	send(tWriter{t, c}, v1.Message("node.metrics", node, auth.Random(), m))
	deadline := time.Now().Add(3 * time.Second)
	var snapshot monitoring.Snapshot
	for time.Now().Before(deadline) {
		res := f.request("GET", "/api/v1/nodes/"+node+"/metrics", nil, true)
		if res.StatusCode != 200 {
			t.Fatal(read(res))
		}
		err = json.NewDecoder(res.Body).Decode(&snapshot)
		res.Body.Close()
		if err != nil {
			t.Fatal(err)
		}
		if snapshot.Latest != nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if snapshot.Latest == nil || snapshot.Stale || *snapshot.Latest.CPU.UsagePercent != usage || snapshot.Latest.Memory != nil || len(snapshot.History) != 1 {
		t.Fatalf("snapshot: %+v", snapshot)
	}
	res := f.request("GET", "/api/v1/nodes", nil, true)
	var nodes NodesResponse
	json.NewDecoder(res.Body).Decode(&nodes)
	res.Body.Close()
	if len(nodes.Items) != 1 || nodes.Items[0].Monitoring.Latest == nil || len(nodes.Items[0].Monitoring.History) != 0 {
		t.Fatal("node summary missing or contains history")
	}
	for _, tc := range []struct {
		path string
		auth bool
		code int
	}{{"/api/v1/nodes/" + node + "/metrics", false, 401}, {"/api/v1/nodes/missing/metrics", true, 404}} {
		res = f.request("GET", tc.path, nil, tc.auth)
		if res.StatusCode != tc.code {
			t.Fatal(read(res))
		}
		res.Body.Close()
	}
	// A session cannot publish another node's counters.
	send(tWriter{t, c}, v1.Message("node.metrics", "other", auth.Random(), m))
	rctx, stop := context.WithTimeout(context.Background(), time.Second)
	defer stop()
	if _, _, err = c.Read(rctx); err == nil {
		t.Fatal("cross-node metrics accepted")
	}
}
func TestLegacyAgentDoesNotReceiveMetricsExtension(t *testing.T) {
	f := setup(t, "admin")
	node, key := f.enroll()
	c := f.socket(node, f.token(node, key))
	defer c.CloseNow()
	m := v1.NodeMetrics{SampledAt: time.Now(), Interfaces: []*v1.InterfaceMetrics{}, Errors: []string{"unsupported_platform"}}
	send(tWriter{t, c}, v1.Message("node.metrics", node, auth.Random(), m))
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if _, _, err := c.Read(ctx); err == nil {
		t.Fatal("unnegotiated metrics accepted")
	}
	if f.gate.Metrics(node, true).Latest != nil {
		t.Fatal("stored unnegotiated metrics")
	}
}
