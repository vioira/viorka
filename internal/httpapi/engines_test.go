package httpapi

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"github.com/vioira/viorka/internal/proxy"
	"github.com/vioira/viorka/internal/scheduler"
	v1 "github.com/vioira/viorka/protocol/v1"
	"net/http"
	"strings"
	"testing"
)

func TestEngineHTTPAuthorizationAndTypedExecution(t *testing.T) {
	f := setup(t, "admin")
	node, _ := f.enroll()
	for _, tc := range []struct {
		method, path string
		body         any
		auth         bool
		status       int
	}{
		{"GET", "/api/v1/nodes/" + node + "/engines", nil, false, 401},
		{"POST", "/api/v1/nodes/" + node + "/engines", map[string]any{"name": "realm", "idempotency_key": "offline", "confirm": true}, true, 409},
		{"POST", "/api/v1/nodes/" + node + "/engines", map[string]any{"name": "realm", "idempotency_key": "url", "confirm": true, "url": "https://evil.example/binary"}, true, 400},
	} {
		r := f.request(tc.method, tc.path, tc.body, tc.auth)
		if r.StatusCode != tc.status {
			t.Errorf("%s %d %s", tc.path, r.StatusCode, read(r))
		}
		r.Body.Close()
	}
	if err := f.store.Online(context.Background(), node, v1.Hello{OS: "linux", Arch: "amd64", Capabilities: []string{v1.EngineCapability}}); err != nil {
		t.Fatal(err)
	}
	r := f.request(http.MethodPost, "/api/v1/nodes/"+node+"/engines", InstallEngineRequest{Name: "realm", IdempotencyKey: "install", Confirm: true}, true)
	if r.StatusCode != 202 {
		t.Fatal(r.StatusCode, read(r))
	}
	var task scheduler.Task
	if err := json.NewDecoder(r.Body).Decode(&task); err != nil {
		t.Fatal(err)
	}
	r.Body.Close()
	if task.State != "queued" {
		t.Fatal("false immediate success")
	}
	summary := decodeResponse[map[string][]map[string]any](t, f.request("GET", "/api/v1/nodes/"+node+"/engines", nil, true), 200)
	if len(summary["items"]) != 1 || summary["items"][0]["draft"] != nil || summary["items"][0]["draft_version"] == nil || summary["items"][0]["service_count"] == nil {
		t.Fatal("list did not return summary", summary)
	}

	d, err := f.store.ClaimEngines(context.Background(), node)
	if err != nil || d == nil {
		t.Fatal(err)
	}
	if d.Operation != "engine.install" || d.Engine.Name != "realm" || d.ResourceKind != "engine" {
		t.Fatal("not typed")
	}
	r = f.request("GET", "/api/v1/engines/"+d.ResourceID, nil, true)
	if r.StatusCode != 200 {
		t.Fatal(read(r))
	}
	var engine map[string]any
	json.NewDecoder(r.Body).Decode(&engine)
	r.Body.Close()
	if engine["status"] != "not_installed" || engine["observed_revision"] != float64(0) {
		t.Fatal("desired became observed", engine)
	}
}
func TestEngineHTTPViewerHasNoImplicitNodeAccess(t *testing.T) {
	f := setup(t, "viewer")
	for _, tc := range []struct {
		method, path string
		body         any
	}{{"GET", "/api/v1/nodes/other/engines", nil}, {"POST", "/api/v1/nodes/other/engines", InstallEngineRequest{Name: "realm", Confirm: true, IdempotencyKey: "forbidden"}}, {"PUT", "/api/v1/engines/other/draft", EngineDraftRequest{}}} {
		r := f.request(tc.method, tc.path, tc.body, true)
		if r.StatusCode != 403 {
			t.Fatalf("%s %d %s", tc.path, r.StatusCode, read(r))
		}
		r.Body.Close()
	}
}

func TestNodeListAndEventsIncludeInstalledEngineSummary(t *testing.T) {
	f := setup(t, "admin")
	node, _ := f.enroll()
	ctx := context.Background()
	if err := f.store.Online(ctx, node, v1.Hello{OS: "linux", Arch: "amd64", Capabilities: []string{v1.EngineCapability}}); err != nil {
		t.Fatal(err)
	}
	expectStatus(t, f.request("POST", "/api/v1/nodes/"+node+"/engines", InstallEngineRequest{Name: "realm", IdempotencyKey: "summary-install", Confirm: true}, true), 202)
	d, err := f.store.ClaimEngines(ctx, node)
	if err != nil || d == nil {
		t.Fatal(err)
	}
	stream := f.request("GET", "/api/v1/events", nil, true)
	defer stream.Body.Close()
	reader := bufio.NewReader(stream.Body)
	nextSSE(t, reader)
	nextSSE(t, reader)
	if err := f.store.Reply(ctx, node, "task.result", v1.TaskReply{TaskID: d.TaskID, ResourceID: d.ResourceID, Attempt: *d.Attempt, State: "succeeded", Engine: &v1.EngineResult{Name: d.Engine.Name, Version: d.Engine.Version, Revision: d.Engine.Revision, Status: "installed"}}); err != nil {
		t.Fatal(err)
	}
	found := false
	for range 4 {
		kind, data := nextSSE(t, reader)
		if kind != "change" {
			continue
		}
		var change ResourceChange
		if err := json.Unmarshal([]byte(data), &change); err != nil {
			t.Fatal(err)
		}
		if change.Node != nil {
			if change.Node.Engines == nil || len(*change.Node.Engines) != 1 || (*change.Node.Engines)[0].Name != "realm" || (*change.Node.Engines)[0].Version != d.Engine.Version {
				t.Fatal(data)
			}
			found = true
			break
		}
	}
	if !found {
		t.Fatal("engine completion did not update node event")
	}
	nodes := decodeResponse[NodesResponse](t, f.request("GET", "/api/v1/nodes", nil, true), 200)
	if len(nodes.Items) != 1 || nodes.Items[0].Engines == nil || len(*nodes.Items[0].Engines) != 1 {
		t.Fatal(nodes)
	}
}

func TestLargeEngineDraftHTTPAndBrowserSocket(t *testing.T) {
	f := setup(t, "admin")
	node, _ := f.enroll()
	ctx := context.Background()
	if err := f.store.Online(ctx, node, v1.Hello{OS: "linux", Arch: "amd64", Capabilities: []string{v1.EngineCapability}}); err != nil {
		t.Fatal(err)
	}
	expectStatus(t, f.request("POST", "/api/v1/nodes/"+node+"/engines", InstallEngineRequest{Name: "sing-box", IdempotencyKey: "large-draft", Confirm: true}, true), 202)
	task, err := f.store.ClaimEngines(ctx, node)
	if err != nil || task == nil {
		t.Fatal("claim install", err)
	}
	if err := f.store.Reply(ctx, node, "task.result", v1.TaskReply{TaskID: task.TaskID, ResourceID: task.ResourceID, Attempt: *task.Attempt, State: "succeeded", Engine: &v1.EngineResult{Name: task.Engine.Name, Version: task.Engine.Version, Revision: task.Engine.Revision, Status: "installed"}}); err != nil {
		t.Fatal(err)
	}
	engine := decodeResponse[proxy.Engine](t, f.request("GET", "/api/v1/engines/"+task.ResourceID, nil, true), 200)
	routing := &proxy.Routing{Final: "direct"}
	for i := range 128 {
		rule := &proxy.RouteRule{ID: fmt.Sprintf("rule-%d", i), Name: "规则", Enabled: true, Outbound: "direct"}
		for j := range 64 {
			rule.Domain = append(rule.Domain, fmt.Sprintf("domain-%d.example.com", j))
		}
		routing.Rules = append(routing.Rules, rule)
	}
	draft := EngineDraftRequest{Version: engine.Draft.Version, Services: engine.Draft.Services, Routing: routing}
	if err := proxy.ValidateDraft("sing-box", proxy.Draft{Version: draft.Version, Services: draft.Services, Routing: routing}); err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(draft)
	if len(body) <= 64<<10 {
		t.Fatal("fixture must exceed both old transport limits")
	}
	saved := decodeResponse[proxy.Draft](t, f.request("PUT", "/api/v1/engines/"+engine.ID+"/draft", draft, true), 200)
	if len(saved.Routing.Rules) != 128 {
		t.Fatal("rules lost")
	}
	draft.Version = saved.Version
	body, _ = json.Marshal(draft)
	c := browserTestSocket(t, f)
	c.SetReadLimit(engineDraftBodyLimit + (64 << 10))
	browserSend(t, c, browserMessage{Type: "request", ID: "large-draft", Method: "saveEngineDraft", Params: browserParams{ID: engine.ID, Body: body}})
	if frame := browserReceive(t, c, "", "large-draft"); frame.Status != 200 {
		t.Fatalf("save: %+v", frame)
	}
	expectStatus(t, f.request("PUT", "/api/v1/engines/"+engine.ID+"/draft", map[string]any{"version": saved.Version, "services": []any{}, "routing": strings.Repeat("x", engineDraftBodyLimit)}, true), 413)
}
