package httpapi

import (
	"context"
	"encoding/json"
	"github.com/coder/websocket"
	"github.com/vioira/viorka/internal/auth"
	v1 "github.com/vioira/viorka/protocol/v1"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestInventoryWSSPersistence(t *testing.T) {
	f := setup(t, "admin")
	node, key := f.enroll()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "wss"+strings.TrimPrefix(f.server.URL, "https")+"/api/v1/agents/ws", &websocket.DialOptions{HTTPClient: f.server.Client(), HTTPHeader: http.Header{"Authorization": []string{"Bearer " + f.token(node, key)}}})
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	send(tWriter{t, c}, v1.Message("system.hello", node, auth.Random(), v1.Hello{ProtocolVersions: []string{v1.Version}, Capabilities: []string{"node.inventory.v1"}, OS: "linux", Arch: "amd64"}))
	ack := receive(t, c)
	var h v1.HelloAck
	if v1.Decode(ack.Payload, &h) != nil || h.InventoryVersion == nil || *h.InventoryVersion != 1 {
		t.Fatal("inventory not negotiated")
	}
	v := v1.NodeInventory{SampledAt: time.Now().UTC(), OSID: "ubuntu", OSName: "Ubuntu 24.04 LTS", OSVersion: "24.04", PublicIpv4: "8.8.8.8", Errors: []string{"public_ipv6_unavailable"}}
	send(tWriter{t, c}, v1.Message("node.inventory", node, auth.Random(), v))
	found := false
	for deadline := time.Now().Add(2 * time.Second); time.Now().Before(deadline); {
		res := f.request("GET", "/api/v1/nodes", nil, true)
		var nodes NodesResponse
		err = json.NewDecoder(res.Body).Decode(&nodes)
		res.Body.Close()
		if err != nil {
			t.Fatal(err)
		}
		if len(nodes.Items) == 1 && nodes.Items[0].Inventory != nil {
			got := nodes.Items[0].Inventory
			if got.OSName != v.OSName || got.PublicIpv4 != v.PublicIpv4 || got.PublicIpv6 != "" {
				t.Fatalf("%+v", got)
			}
			found = true
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !found {
		t.Fatal("inventory not persisted through WSS")
	}
	send(tWriter{t, c}, v1.Message("node.inventory", "other", auth.Random(), v))
	if _, _, err = c.Read(ctx); err == nil {
		t.Fatal("cross-node inventory accepted")
	}
}
func TestLegacyInventoryRejected(t *testing.T) {
	f := setup(t, "admin")
	node, key := f.enroll()
	c := f.socket(node, f.token(node, key))
	defer c.CloseNow()
	send(tWriter{t, c}, v1.Message("node.inventory", node, auth.Random(), v1.NodeInventory{}))
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if _, _, err := c.Read(ctx); err == nil {
		t.Fatal("unnegotiated inventory accepted")
	}
}
