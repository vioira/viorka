package storage

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/vioira/viorka/internal/auth"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func TestAgentUpdateReconcilesAfterDisconnect(t *testing.T) {
	s := engineFixture(t)
	ctx := context.Background()
	target := v1.AgentUpdate{Version: "v10.0.0", SHA256: strings.Repeat("b", 64)}
	hello := v1.Hello{OS: "linux", Arch: "amd64", AgentVersion: "2.0.0", Capabilities: []string{v1.AgentUpdateCapability}}
	if err := s.Online(ctx, "node", hello); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveAgentReleases(ctx, map[string]v1.AgentUpdate{"amd64": target}); err != nil {
		t.Fatal(err)
	}
	if err := s.SetAgentAutoUpdate(ctx, "admin", "node", true); err != nil {
		t.Fatal(err)
	}
	if err := s.ManagementDisconnected(ctx, "node"); err != nil {
		t.Fatal(err)
	}
	if id, err := s.ScheduleAgentUpdate(ctx, ""); err != nil || id != "" {
		t.Fatal("disconnected dispatch", id, err)
	}
	if err := s.Online(ctx, "node", hello); err != nil {
		t.Fatal(err)
	}
	if id, err := s.ScheduleAgentUpdate(ctx, ""); err != nil || id != "node" {
		t.Fatal(id, err)
	}
	d, err := s.ClaimNodeOperations(ctx, "node", false, false, true)
	if err != nil || d == nil {
		t.Fatal(d, err)
	}
	if _, err = s.CreateTask(ctx, "admin", "node", "inspection"); err != nil {
		t.Fatal(err)
	}
	// Expired execution deadline permits receipt reconciliation only. The Agent
	// independently checks the original deadline before starting new work.
	if _, err = s.db.Exec(`UPDATE tasks SET state='accepted',deadline_at=?,lease_until=? WHERE id=?`, at(time.Now().Add(-time.Minute)), at(time.Now().Add(-time.Minute)), d.TaskID); err != nil {
		t.Fatal(err)
	}
	if err = s.Expire(ctx); err != nil {
		t.Fatal(err)
	}
	if other, err := s.Claim(ctx, "node"); err != nil || other != nil {
		t.Fatal("inspection bypassed in-flight update", other, err)
	}
	again, err := s.ClaimNodeOperations(ctx, "node", false, false, true)
	if err != nil || again == nil || again.TaskID != d.TaskID || *again.Attempt != *d.Attempt {
		t.Fatal("lost receipt", again, err)
	}
	reply := v1.TaskReply{TaskID: d.TaskID, ResourceID: "node", Attempt: *d.Attempt, State: "failed", AgentUpdate: &target, ErrorCode: "update_rolled_back"}
	if err = s.Reply(ctx, "other", "task.result", reply); err == nil {
		t.Fatal("foreign reply accepted")
	}
	if err = s.Reply(ctx, "node", "task.result", reply); err != nil {
		t.Fatal(err)
	}
	result, err := s.Task(ctx, d.TaskID)
	if err != nil || result.ErrorCode != reply.ErrorCode {
		t.Fatal(result, err)
	}
	if id, err := s.ScheduleAgentUpdate(ctx, ""); err != nil || id != "" {
		t.Fatal("automatic retry after rollback", id, err)
	}
	if _, err = s.QueueAgentUpdate(ctx, "admin", "node", target); !errors.Is(err, auth.ErrConflict) {
		t.Fatal("queued inspection conflict", err)
	}
}
