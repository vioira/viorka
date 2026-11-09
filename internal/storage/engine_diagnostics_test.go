package storage

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	v1 "github.com/vioira/viorka/protocol/v1"
)

func TestEngineDiagnosticPersistence(t *testing.T) {
	s := engineFixture(t)
	d := actionEngine(t, s, "sing", "diagnostic", "engine.inspect", 0)
	reply := v1.TaskReply{TaskID: d.TaskID, ResourceID: d.ResourceID, Attempt: *d.Attempt, State: "failed", ErrorCode: "engine_result_unknown",
		Engine: &v1.EngineResult{Name: d.Engine.Name, Version: d.Engine.Version, Revision: d.Engine.Revision, Status: "unknown", ErrorCode: "engine_result_unknown",
			Diagnostic: &v1.EngineDiagnostic{Stage: "extract", Message: "上次执行异常中断", Interrupted: true}}}
	for _, invalid := range []*v1.EngineDiagnostic{
		{Stage: "shell", Message: "bad"},
		{Stage: "extract", Message: strings.Repeat("界", 513)},
		{Stage: "extract", Message: "bad\ncontrol"},
	} {
		reply.Engine.Diagnostic = invalid
		if err := s.Reply(context.Background(), "node", "task.result", reply); err == nil {
			t.Fatal("invalid diagnostic accepted")
		}
	}
	reply.Engine.Diagnostic = &v1.EngineDiagnostic{Stage: "extract", Message: "上次执行异常中断", Interrupted: true}
	if err := s.Reply(context.Background(), "node", "task.result", reply); err != nil {
		t.Fatal(err)
	}
	task, err := s.Task(context.Background(), d.TaskID)
	if err != nil {
		t.Fatal(err)
	}
	var persisted v1.TaskReply
	if err := json.Unmarshal(task.Result, &persisted); err != nil {
		t.Fatal(err)
	}
	if persisted.Engine.Diagnostic == nil || persisted.Engine.Diagnostic.Stage != "extract" || !persisted.Engine.Diagnostic.Interrupted {
		t.Fatalf("%+v", persisted)
	}
}

func TestEngineLatestFailureVisibleWithoutConfigTarget(t *testing.T) {
	for _, id := range []string{"sing", "xray", "realm"} {
		t.Run(id, func(t *testing.T) {
			s := engineFixture(t)
			ctx := context.Background()
			d := actionEngine(t, s, id, "conflict", "engine.inspect", 0)
			reply := v1.TaskReply{TaskID: d.TaskID, ResourceID: d.ResourceID, Attempt: *d.Attempt, State: "failed", ErrorCode: "engine_external",
				Engine: &v1.EngineResult{Name: d.Engine.Name, Version: d.Engine.Version, Revision: d.Engine.Revision, Status: "unknown", ErrorCode: "engine_external"}}
			if err := s.Reply(ctx, "node", "task.result", reply); err != nil {
				t.Fatal(err)
			}
			engine, err := s.Engine(ctx, "admin", id)
			if err != nil {
				t.Fatal(err)
			}
			if engine.LastError != "engine_external" || engine.SyncState != "unpublished" || engine.ObservedRevision != 0 {
				t.Fatalf("unexpected engine state: %+v", engine)
			}
			d = actionEngine(t, s, id, "recheck", "engine.inspect", 0)
			replyEngine(t, s, d, "installed")
			engines, err := s.Engines(ctx, "admin", "node")
			if err != nil {
				t.Fatal(err)
			}
			for _, engine := range engines {
				if engine.ID == id && (engine.LastError != "" || engine.Status != "installed" || engine.ObservedRevision != 0) {
					t.Fatalf("recheck did not clear failure: %+v", engine)
				}
			}
		})
	}
}
