package httpapi

import (
	"context"
	"github.com/vioira/viorka/internal/inventory"
	"strings"
	"testing"
)

func TestNodeDetailsAndTaskList(t *testing.T) {
	f := setup(t, "admin")
	node, _ := f.enroll()
	other, _ := f.enroll()
	n := decodeResponse[inventory.Node](t, f.request("GET", "/api/v1/nodes/"+node, nil, true), 200)
	if n.ID != node || n.Name == "" || n.Kind == "" || n.Monitoring == nil || !n.Monitoring.Stale {
		t.Fatalf("incomplete details: %+v", n)
	}
	for _, path := range []string{"/api/v1/nodes/" + node, "/api/v1/nodes/" + node + "/tasks"} {
		expectStatus(t, f.request("GET", path, nil, false), 401)
	}
	expectStatus(t, f.request("GET", "/api/v1/nodes/missing", nil, true), 404)
	expectStatus(t, f.request("GET", "/api/v1/nodes/missing/tasks", nil, true), 404)
	expectStatus(t, f.request("GET", "/api/v1/nodes/"+strings.Repeat("a", 129), nil, true), 400)
	for _, key := range []string{"a", "b"} {
		if _, err := f.store.CreateTask(context.Background(), "user", node, key); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := f.store.CreateTask(context.Background(), "user", other, "other"); err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/nodes/" + node + "/tasks"
	first := decodeResponse[NodeTasksResponse](t, f.request("GET", path+"?limit=1", nil, true), 200)
	second := decodeResponse[NodeTasksResponse](t, f.request("GET", path+"?limit=1&after="+first.Items[0].ID, nil, true), 200)
	if len(first.Items) != 1 || len(second.Items) != 1 || first.Items[0].ID == second.Items[0].ID || first.Items[0].NodeID != node || second.Items[0].NodeID != node {
		t.Fatal("pagination or isolation failed")
	}
	if first.Items[0].IdempotencyKey != "b" || second.Items[0].IdempotencyKey != "a" {
		t.Fatal("tasks not newest first")
	}
	otherTasks := decodeResponse[NodeTasksResponse](t, f.request("GET", "/api/v1/nodes/"+other+"/tasks", nil, true), 200)
	expectStatus(t, f.request("GET", path+"?after="+otherTasks.Items[0].ID, nil, true), 400)
	last := decodeResponse[NodeTasksResponse](t, f.request("GET", path+"?after="+second.Items[0].ID, nil, true), 200)
	if len(last.Items) != 0 {
		t.Fatal("unexpected tasks")
	}
	expectStatus(t, f.request("GET", path+"?limit=101", nil, true), 400)
	expectStatus(t, f.request("GET", path+"?after=missing", nil, true), 400)
	expectStatus(t, f.request("GET", path+"?after="+strings.Repeat("x", 129), nil, true), 400)
	f.store.Close()
	expectStatus(t, f.request("GET", "/api/v1/nodes/"+node, nil, true), 503)
}
func TestViewerReadsNodeDetails(t *testing.T) {
	f := setup(t, "viewer")
	// Missing is reached only after the viewer's authorization succeeds.
	expectStatus(t, f.request("GET", "/api/v1/nodes/missing", nil, true), 404)
	expectStatus(t, f.request("GET", "/api/v1/nodes/missing/tasks", nil, true), 404)
	expectStatus(t, f.request("POST", "/api/v1/nodes/missing/revoke", nil, true), 403)
}
