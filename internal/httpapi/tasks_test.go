package httpapi

import (
	"context"
	"strings"
	"testing"

	"github.com/vioira/viorka/internal/scheduler"
)

func TestTaskCenterAPI(t *testing.T) {
	f := setup(t, "admin")
	for _, path := range []string{"/api/v1/tasks", "/api/v1/tasks/summary", "/api/v1/tasks/missing"} {
		expectStatus(t, f.request("GET", path, nil, false), 401)
	}
	empty := decodeResponse[scheduler.Page](t, f.request("GET", "/api/v1/tasks", nil, true), 200)
	if empty.Items == nil || len(empty.Items) != 0 || empty.NextCursor != "" {
		t.Fatalf("empty %+v", empty)
	}
	n1, _ := f.enroll()
	n2, _ := f.enroll()
	first, err := f.store.CreateTask(context.Background(), "user", n1, "first")
	if err != nil {
		t.Fatal(err)
	}
	second, err := f.store.CreateTask(context.Background(), "user", n2, "second")
	if err != nil {
		t.Fatal(err)
	}
	page := decodeResponse[scheduler.Page](t, f.request("GET", "/api/v1/tasks?limit=1", nil, true), 200)
	if len(page.Items) != 1 || page.Items[0].ID != second.ID || page.NextCursor != second.ID {
		t.Fatalf("page %+v", page)
	}
	next := decodeResponse[scheduler.Page](t, f.request("GET", "/api/v1/tasks?limit=1&after="+page.NextCursor, nil, true), 200)
	if len(next.Items) != 1 || next.Items[0].ID != first.ID || next.NextCursor != "" {
		t.Fatalf("next %+v", next)
	}
	failed := decodeResponse[scheduler.Page](t, f.request("GET", "/api/v1/tasks?state=failed", nil, true), 200)
	if len(failed.Items) != 0 {
		t.Fatal("state filter ignored")
	}
	detail := decodeResponse[scheduler.Task](t, f.request("GET", "/api/v1/tasks/"+second.ID, nil, true), 200)
	if detail.ID != second.ID || detail.CreatedAt == "" || detail.UpdatedAt == "" || detail.NodeName == "" || detail.MaxAttempts != 3 || string(detail.Result) != "null" {
		t.Fatalf("detail %+v", detail)
	}
	summary := decodeResponse[scheduler.Summary](t, f.request("GET", "/api/v1/tasks/summary", nil, true), 200)
	if summary.Total != 2 || summary.Active != 2 || summary.SuccessRate != nil {
		t.Fatalf("summary %+v", summary)
	}
	for _, query := range []string{"limit=0", "limit=101", "limit=no", "limit=", "after=missing", "state=invalid", "limit=1&limit=2", "state=all&state=failed", "sort=id", "after=" + strings.Repeat("a", 129)} {
		expectStatus(t, f.request("GET", "/api/v1/tasks?"+query, nil, true), 400)
	}
	expectStatus(t, f.request("GET", "/api/v1/tasks/summary?limit=1", nil, true), 400)
	expectStatus(t, f.request("GET", "/api/v1/tasks/missing", nil, true), 404)
	f.store.Close()
	for _, path := range []string{"/api/v1/tasks", "/api/v1/tasks/summary", "/api/v1/tasks/" + second.ID} {
		expectStatus(t, f.request("GET", path, nil, true), 503)
	}
}
func TestTaskCenterRoles(t *testing.T) {
	for _, role := range []string{"viewer", "operator"} {
		t.Run(role, func(t *testing.T) {
			f := setup(t, role)
			node, _ := f.enroll()
			task, err := f.store.CreateTask(context.Background(), "user", node, "key")
			if err != nil {
				t.Fatal(err)
			}
			for _, path := range []string{"/api/v1/tasks", "/api/v1/tasks/summary", "/api/v1/tasks/" + task.ID} {
				expectStatus(t, f.request("GET", path, nil, true), 200)
			}
			status := 202
			if role == "viewer" {
				status = 403
			}
			expectStatus(t, f.request("POST", "/api/v1/nodes/"+node+"/tasks", TaskRequest{Operation: "node.inspect", IdempotencyKey: "new-inspection"}, true), status)
		})
	}
}
