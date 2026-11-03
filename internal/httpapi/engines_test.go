package httpapi

import (
	"context"
	"encoding/json"
	"github.com/vioira/viorka/internal/scheduler"
	v1 "github.com/vioira/viorka/protocol/v1"
	"net/http"
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
