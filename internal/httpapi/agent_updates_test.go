package httpapi

import (
	"context"
	"strings"
	"testing"

	"github.com/vioira/viorka/internal/agentupdate"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func TestAgentUpdatePolicyDispatchAndConfirmation(t *testing.T) {
	f := setup(t, "admin")
	node, _ := f.enroll()
	ctx := context.Background()
	path := "/api/v1/nodes/" + node + "/agent-update"
	readStatus := func() agentupdate.AgentUpdateStatus {
		return decodeResponse[agentupdate.AgentUpdateStatus](t, f.request("GET", path, nil, true), 200)
	}
	if s := readStatus(); s.Auto || s.Online || s.Available {
		t.Fatalf("unexpected defaults: %+v", s)
	}
	u := v1.AgentUpdate{Version: "v2.0.0", SHA256: strings.Repeat("a", 64)}
	if err := f.store.SaveAgentReleases(ctx, map[string]v1.AgentUpdate{"amd64": u}); err != nil {
		t.Fatal(err)
	}
	expectStatus(t, f.request("POST", path, u, true), 409)
	h := v1.Hello{OS: "linux", Arch: "amd64", AgentVersion: "1.0.0", Capabilities: []string{v1.AgentUpdateCapability}}
	if err := f.store.Online(ctx, node, h); err != nil {
		t.Fatal(err)
	}
	expectStatus(t, f.request("PUT", path, map[string]any{}, true), 400)
	expectStatus(t, f.request("GET", path, nil, false), 401)
	auto := func(enabled bool) {
		s := decodeResponse[agentupdate.AgentUpdateStatus](t, f.request("PUT", path, map[string]bool{"auto_update": enabled}, true), 200)
		if s.Auto != enabled {
			t.Fatal(s)
		}
	}
	schedule := func() {
		if _, err := f.store.ScheduleAgentUpdate(ctx, ""); err != nil {
			t.Fatal(err)
		}
	}
	schedule()
	if readStatus().ActiveTask != "" {
		t.Fatal("disabled policy created a task")
	}
	auto(true)
	schedule()
	id := readStatus().ActiveTask
	if id == "" {
		t.Fatal("no automatic update")
	}
	auto(false)
	cancelled, err := f.store.Task(ctx, id)
	if err != nil || cancelled.State != "cancelled" {
		t.Fatal(cancelled, err)
	}
	task := decodeResponse[TaskResponse](t, f.request("POST", path, u, true), 202)
	if task.AgentUpdate == nil || task.AgentUpdate.Source != "manual" || task.AgentUpdate.From != h.AgentVersion || task.AgentUpdate.Target != u {
		t.Fatal("missing pinned update details", task.AgentUpdate)
	}
	again := decodeResponse[TaskResponse](t, f.request("POST", path, u, true), 202)
	if again.ID != task.ID {
		t.Fatal("duplicate task")
	}
	if d, err := f.store.ClaimNodeOperations(ctx, node, true, false, false); err != nil || d != nil {
		t.Fatal("legacy delivery", d, err)
	}
	d, err := f.store.ClaimNodeOperations(ctx, node, false, false, true)
	if err != nil || d == nil || d.AgentUpdate == nil || *d.AgentUpdate != u {
		t.Fatal(d, err)
	}
	reply := v1.TaskReply{TaskID: d.TaskID, Attempt: *d.Attempt, ResourceID: node, State: "accepted"}
	if err = f.store.Reply(ctx, node, "task.ack", reply); err != nil {
		t.Fatal(err)
	}
	auto(false)
	if got, err := f.store.Task(ctx, task.ID); err != nil || got.State != "accepted" {
		t.Fatal(got, err)
	}
	reply.State = "succeeded"
	reply.AgentUpdate = &u
	if err = f.store.Reply(ctx, node, "task.result", reply); err == nil {
		t.Fatal("old agent completed update")
	}
	h.AgentVersion = "2.0.0"
	if err = f.store.Online(ctx, node, h); err != nil {
		t.Fatal(err)
	}
	if err = f.store.Reply(ctx, node, "task.result", reply); err != nil {
		t.Fatal(err)
	}
	if s := readStatus(); s.ActiveTask != "" || s.Available {
		t.Fatal(s)
	}
	result, err := f.store.Task(ctx, task.ID)
	if err != nil || result.State != "succeeded" {
		t.Fatal(result, err)
	}
}
func TestAgentUpdateRestrictedToAdmin(t *testing.T) {
	for _, role := range []string{"viewer", "operator"} {
		t.Run(role, func(t *testing.T) {
			f := setup(t, role)
			node, _ := f.enroll()
			path := "/api/v1/nodes/" + node + "/agent-update"
			expectStatus(t, f.request("GET", path, nil, true), 200)
			for _, method := range []string{"POST", "PUT"} {
				expectStatus(t, f.request(method, path, map[string]any{}, true), 403)
			}
		})
	}
}
