package storage

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/proxy"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func TestManagedRecoveryReplacesRejectedInstallAndPreservesConnections(t *testing.T) {
	ctx := context.Background()
	s := engineFixture(t)
	service := sampleService("service-original", 15443)
	draft := saveEngine(t, s, "sing", proxy.Draft{Services: []proxy.Service{service}})
	applied := actionEngine(t, s, "sing", "apply-original", "engine.apply", draft.Version)
	replyEngine(t, s, applied, "running")
	before, err := s.EngineConnections(ctx, "admin", "sing")
	if err != nil || len(before) != 1 {
		t.Fatalf("original link: %v", err)
	}
	if err = s.DeleteNode(ctx, "admin", "node"); err != nil {
		t.Fatal(err)
	}
	replacement := "other"
	hello := v1.Hello{OS: "linux", Arch: "amd64", Capabilities: []string{v1.EngineCapability}}
	if err = s.Online(ctx, replacement, hello); err != nil {
		t.Fatal(err)
	}
	if _, err = s.StartManagedRecovery(ctx, "admin", replacement, "sing-box", "preview"); !errors.Is(err, proxy.ErrRecoveryUnsupported) {
		t.Fatal(err)
	}
	hello.Capabilities = append(hello.Capabilities, v1.EngineRecoveryCapability)
	if err = s.Online(ctx, replacement, hello); err != nil {
		t.Fatal(err)
	}

	install, err := s.InstallEngine(ctx, "admin", replacement, "sing-box", proxy.Action{Operation: "engine.install", Confirm: true, IdempotencyKey: "install"})
	if err != nil {
		t.Fatal(err)
	}
	d, err := s.ClaimEngines(ctx, replacement)
	if err != nil || d == nil || d.TaskID != install.ID {
		t.Fatal(d, err)
	}
	failed := v1.TaskReply{TaskID: d.TaskID, ResourceID: d.ResourceID, Attempt: *d.Attempt, State: "failed", ErrorCode: "engine_external", Engine: &v1.EngineResult{Name: d.Engine.Name, Version: d.Engine.Version, Revision: d.Engine.Revision, Status: "unknown", ErrorCode: "engine_external"}}
	if err = s.Reply(ctx, replacement, "task.result", failed); err != nil {
		t.Fatal(err)
	}

	task, err := s.StartManagedRecovery(ctx, "admin", replacement, "sing-box", "preview")
	if err != nil {
		t.Fatal(err)
	}
	again, err := s.StartManagedRecovery(ctx, "admin", replacement, "sing-box", "preview")
	if err != nil || again.ID != task.ID {
		t.Fatal("preview request is not idempotent", err)
	}
	if _, err = s.ConfirmManagedRecovery(ctx, "admin", replacement, task.ID); !errors.Is(err, proxy.ErrConflict) {
		t.Fatal(err)
	}
	deliverManagedRecoveryPreview(t, s, replacement, task.ID, &v1.EngineRecovery{EngineID: "sing", Command: applied.Engine, Status: "running"})
	view, err := s.PreviewManagedRecovery(ctx, "admin", replacement, task.ID)
	if err != nil || view.EngineID != "sing" || view.Status != "running" || len(view.Services) != 1 || view.Services[0].ID != service.ID {
		t.Fatal(view, err)
	}

	raw, _ := json.Marshal(view)
	stored, err := s.Task(ctx, task.ID)
	secret := applied.Engine.Services[0].PrivateKey
	if err != nil || strings.Contains(string(raw), secret) || strings.Contains(string(stored.Result), secret) || strings.Contains(string(stored.Result), "snapshot_encrypted") {
		t.Fatal("private data in recovery preview or task result", err)
	}
	if _, err = s.Engine(ctx, "admin", "sing"); !errors.Is(err, auth.ErrNotFound) {
		t.Fatal("preview changed engine ownership", err)
	}

	for range 2 {
		id, err := s.ConfirmManagedRecovery(ctx, "admin", replacement, task.ID)
		if err != nil || id != "sing" {
			t.Fatal(id, err)
		}
	}
	if _, err = s.Engine(ctx, "admin", d.ResourceID); !errors.Is(err, auth.ErrNotFound) {
		t.Fatal("failed install placeholder remains", err)
	}
	if oldTask, err := s.Task(ctx, install.ID); err != nil || oldTask.State != "failed" {
		t.Fatal("install history disappeared", err)
	}
	engine, err := s.Engine(ctx, "admin", "sing")
	if err != nil || engine.NodeID != replacement || engine.ObservedRevision != int64(applied.Engine.Revision) || engine.PublishedRevision != int64(applied.Engine.Revision) {
		t.Fatal(engine, err)
	}
	links, err := s.EngineConnections(ctx, "admin", "sing")
	if err != nil || len(links) != 1 || links[0].URL != before[0].URL {
		t.Fatal("link or entry changed", err)
	}
	if next, err := s.ClaimEngines(ctx, replacement); err != nil || next != nil {
		t.Fatal("recovery dispatched a lifecycle operation", next, err)
	}
}

func TestManagedRecoveryRefusesChangedOrForeignRecords(t *testing.T) {
	for _, testcase := range []string{"draft", "other-owner", "expired"} {
		t.Run(testcase, func(t *testing.T) {
			ctx := context.Background()
			s := engineFixture(t)
			if err := s.Online(ctx, "other", v1.Hello{OS: "linux", Arch: "amd64", Capabilities: []string{v1.EngineCapability, v1.EngineRecoveryCapability}}); err != nil {
				t.Fatal(err)
			}
			task, err := s.StartManagedRecovery(ctx, "admin", "other", "realm", "inspect")
			if err != nil {
				t.Fatal(err)
			}
			c := &v1.EngineCommand{Name: "realm", Version: v1.EngineVersion("realm"), Revision: 4, RunIntent: "running", Services: []*v1.EngineService{}}
			deliverManagedRecoveryPreview(t, s, "other", task.ID, &v1.EngineRecovery{EngineID: "realm", Status: "stopped", Command: c, Unconfigured: true})
			want := proxy.ErrRecoveryOwned
			switch testcase {
			case "draft":
				if _, err := s.db.Exec(`INSERT INTO engines(id,node_id,name,ownership,status) VALUES('new','other','realm','managed','not_installed'); INSERT INTO engine_drafts(engine_id,version,updated_at) VALUES('new',1,'now')`); err != nil {
					t.Fatal(err)
				}
				want = proxy.ErrRecoveryOccupied
			case "expired":
				if _, err := s.db.Exec(`UPDATE tasks SET deadline_at=? WHERE id=?`, at(time.Now().Add(-time.Second)), task.ID); err != nil {
					t.Fatal(err)
				}
				want = proxy.ErrRecoveryExpired
			}
			if _, err = s.ConfirmManagedRecovery(ctx, "admin", "other", task.ID); !errors.Is(err, want) {
				t.Fatalf("want %v, got %v", want, err)
			}
			if _, err = s.PreviewManagedRecovery(ctx, "operator", "other", task.ID); !errors.Is(err, proxy.ErrForbidden) {
				t.Fatal("non-admin can read preview", err)
			}
			if _, err = s.PreviewManagedRecovery(ctx, "admin", "node", task.ID); !errors.Is(err, auth.ErrNotFound) {
				t.Fatal("different node can read preview", err)
			}
		})
	}
}

func deliverManagedRecoveryPreview(t *testing.T, s *Store, node, task string, snapshot *v1.EngineRecovery) {
	t.Helper()
	ctx := context.Background()
	d, err := s.Claim(ctx, node)
	if err != nil || d == nil || d.Operation != v1.EngineRecoverOperation || d.TaskID != task || d.ResourceID != node || d.Engine.Name != snapshot.Command.Name {
		t.Fatal(d, err)
	}
	reply := v1.TaskReply{TaskID: task, ResourceID: node, Attempt: *d.Attempt, State: "succeeded", Engine: &v1.EngineResult{Name: d.Engine.Name, Version: snapshot.Command.Version, Status: snapshot.Status, Recovery: snapshot}}
	late := reply
	late.Attempt++
	if err := s.Reply(ctx, node, "task.result", late); !errors.Is(err, auth.ErrConflict) {
		t.Fatal("wrong attempt accepted", err)
	}
	for range 2 {
		if err := s.Reply(ctx, node, "task.result", reply); err != nil {
			t.Fatal(err)
		}
	}
}

func TestEnrollmentRestoresUnconfiguredEngineWithoutPublishing(t *testing.T) {
	ctx := context.Background()
	s := engineFixture(t)
	agents := auth.NewAgents(s)
	enrollment, err := agents.CreateEnrollment(ctx, "admin", "replacement", "vps")
	if err != nil {
		t.Fatal(err)
	}
	snapshot := &v1.EngineRecovery{EngineID: "old-realm", Status: "stopped", Unconfigured: true, Command: &v1.EngineCommand{Name: "realm", Version: v1.EngineVersion("realm"), Revision: 7, RunIntent: "running", Services: []*v1.EngineService{}}}
	if _, err = s.Enroll(ctx, auth.Hash(enrollment.Token), "new-key", snapshot); err != nil {
		t.Fatal(err)
	}
	engine, err := s.Engine(ctx, "admin", snapshot.EngineID)
	if err != nil || engine.Status != "installed" || engine.PublishedDraft != nil || engine.ObservedRevision != 7 || engine.RunIntent != "running" {
		t.Fatal(engine, err)
	}
}
