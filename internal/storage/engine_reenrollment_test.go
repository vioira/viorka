package storage

import (
	"context"
	"errors"
	"testing"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/proxy"
	"github.com/vioira/viorka/internal/subscription"
	"github.com/vioira/viorka/migrations"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func reenrollEngineNode(t *testing.T, s *Store) {
	t.Helper()
	ctx := context.Background()
	if err := s.AgentStopped(ctx, "node"); err != nil {
		t.Fatal(err)
	}
	token, err := auth.NewAgents(s).ResetEnrollment(ctx, "admin", "node")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ { // An exact retry also covers a lost enrollment response.
		if _, err = s.Enroll(ctx, auth.Hash(token.Token), "replacement-key"); err != nil {
			t.Fatal(err)
		}
	}
}

func TestReenrollmentVerifiesEachEngine(t *testing.T) {
	ctx := context.Background()
	s := engineFixture(t)
	original := map[string]*v1.EngineCommand{}
	for i, id := range []string{"sing", "xray", "realm"} {
		service := sampleService(id, 8443+i)
		if id == "realm" {
			service.ServerName = ""
		}
		draft := saveEngine(t, s, id, proxy.Draft{Services: []proxy.Service{service}})
		apply := actionEngine(t, s, id, id+"-original", "engine.apply", draft.Version)
		replyEngine(t, s, apply, "running")
		original[id] = apply.Engine
	}
	item, token, err := s.SaveSubscription(ctx, "admin", "", subscription.Edit{Name: "test", Port: 7890, RuleIDs: []string{"mihomo"}, Services: []subscription.ServiceRef{{NodeID: "node", EngineID: "sing", ServiceID: "sing"}}})
	if err != nil || item.ID == "" {
		t.Fatal(err)
	}
	reenrollEngineNode(t, s)
	if _, err = s.FetchSubscription(ctx, token, "clash-verge", ""); !errors.Is(err, subscription.ErrNoServices) {
		t.Fatal("pre-verification subscription", err)
	}
	if _, err := s.EngineConnections(ctx, "admin", "sing"); !errors.Is(err, proxy.ErrConflict) {
		t.Fatalf("old credentials available: %v", err)
	}
	items, err := s.Engines(ctx, "admin", "node")
	if err != nil || len(items) != 3 {
		t.Fatal(items, err)
	}
	for _, e := range items {
		if e.Status != "unknown" || e.ObservedAt != "" || e.Version != "" || e.ObservedRevision != 0 || e.ReenrollmentCheck != "pending" || len(e.Draft.Services) != 1 {
			t.Fatal(e)
		}
	}
	if err = s.Online(ctx, "node", v1.Hello{OS: "linux", Arch: "amd64"}); err != nil {
		t.Fatal(err)
	}
	e, err := s.Engine(ctx, "admin", "sing")
	if err != nil || e.ReenrollmentCheck != "unsupported" {
		t.Fatal(e, err)
	}
	hello := v1.Hello{OS: "linux", Arch: "amd64", Capabilities: []string{v1.EngineCapability}}
	if err = s.Online(ctx, "node", hello); err != nil {
		t.Fatal(err)
	}
	if _, err = s.EngineAction(ctx, "admin", "sing", proxy.Action{Operation: "engine.start", Confirm: true, IdempotencyKey: "unsafe"}); !errors.Is(err, proxy.ErrConflict) {
		t.Fatal(err)
	}
	for range items {
		d, err := s.ClaimEngines(ctx, "node")
		if err != nil || d == nil || !d.Engine.RecoveryCheck {
			t.Fatal(d, err)
		}
		r := recoveryReply(d, original[d.ResourceID])
		switch d.ResourceID {
		case "xray":
			r.Engine.Recovery = nil
			r.Engine.Status = "not_installed"
			zero := uint64(0)
			r.Engine.RecoveryRevision = &zero
		case "realm":
			r.Engine.Recovery.Command.Services[0].TargetPort++
			r.Engine.Recovery.Status = "stopped"
			r.Engine.Status = "stopped"
		}
		if err = s.Reply(ctx, "node", "task.result", r); err != nil {
			t.Fatal(err)
		}
	}
	for _, x := range []struct{ id, status, check string }{{"sing", "running", ""}, {"xray", "not_installed", ""}, {"realm", "stopped", "mismatch"}} {
		e, err := s.Engine(ctx, "admin", x.id)
		if err != nil || e.Status != x.status || e.ReenrollmentCheck != x.check || len(e.Draft.Services) != 1 || e.DesiredRevision != int64(original[x.id].Revision) {
			t.Fatal(x, e, err)
		}
	}
	if _, err = s.FetchSubscription(ctx, token, "clash-verge", ""); err != nil {
		t.Fatal("verified subscription", err)
	}
	if links, err := s.EngineConnections(ctx, "admin", "sing"); err != nil || len(links) != 1 {
		t.Fatal(links, err)
	}
	if err = s.Online(ctx, "node", hello); err != nil {
		t.Fatal(err)
	}
	if d, err := s.ClaimEngines(ctx, "node"); err != nil || d != nil {
		t.Fatal("ordinary reconnect created a task", d, err)
	}
	e, err = s.Engine(ctx, "admin", "xray")
	if err != nil || e.PublishedDraft != nil || e.Version != "" {
		t.Fatal(e, err)
	}
	d := actionEngine(t, s, "xray", "new-install", "engine.install", e.Draft.Version)
	var lastAbsent int64
	if err := s.db.QueryRow(`SELECT last_absent_revision FROM engines WHERE id='xray'`).Scan(&lastAbsent); err != nil || lastAbsent != int64(original["xray"].Revision) || int64(d.Engine.Revision) != lastAbsent+1 {
		t.Fatalf("reinstall after confirmed absence: boundary=%d install=%d err=%v", lastAbsent, d.Engine.Revision, err)
	}
	replyEngine(t, s, d, "installed")
	d = actionEngine(t, s, "xray", "new-apply", "engine.apply", e.Draft.Version)
	if _, err = s.EngineConnections(ctx, "admin", "xray"); !errors.Is(err, proxy.ErrConflict) {
		t.Fatal("exported historical credentials", err)
	}
	replyEngine(t, s, d, "stopped")
	if links, err := s.EngineConnections(ctx, "admin", "xray"); err != nil || len(links) != 1 || d.Engine.Services[0].Uuid == original["xray"].Services[0].Uuid {
		t.Fatal("republication failed", err)
	}
}

func TestReenrollmentFailedCheckRemainsUnknownAndRetries(t *testing.T) {
	s := engineFixture(t)
	ctx := context.Background()
	if _, err := s.db.Exec(`DELETE FROM engines WHERE id!='sing'`); err != nil {
		t.Fatal(err)
	}
	reenrollEngineNode(t, s)
	if err := s.Online(ctx, "node", v1.Hello{OS: "linux", Arch: "amd64", Capabilities: []string{v1.EngineCapability}}); err != nil {
		t.Fatal(err)
	}
	d, err := s.ClaimEngines(ctx, "node")
	if err != nil || d == nil {
		t.Fatal(d, err)
	}
	r := v1.TaskReply{TaskID: d.TaskID, Attempt: *d.Attempt, ResourceID: d.ResourceID, State: "failed", ErrorCode: "engine_external", Engine: &v1.EngineResult{Revision: d.Engine.Revision, Name: d.Engine.Name, Status: "not_installed", ErrorCode: "engine_external"}}
	if err = s.Reply(ctx, "node", "task.result", r); err != nil {
		t.Fatal(err)
	}
	e, err := s.Engine(ctx, "admin", "sing")
	if err != nil || e.ReenrollmentCheck != "failed" || e.LastError != "engine_external" || e.Status != "unknown" {
		t.Fatal(e, err)
	}
	retry := actionEngine(t, s, "sing", "retry", "engine.inspect", e.Draft.Version)
	if !retry.Engine.RecoveryCheck {
		t.Fatal("ordinary inspect bypassed verification")
	}
	if err = s.Reply(ctx, "node", "task.result", r); err != nil {
		t.Fatal(err)
	}
	revision := uint64(0)
	r = v1.TaskReply{TaskID: retry.TaskID, Attempt: *retry.Attempt, ResourceID: retry.ResourceID, State: "succeeded", Engine: &v1.EngineResult{Revision: retry.Engine.Revision, Name: retry.Engine.Name, Version: retry.Engine.Version, Status: "not_installed", RecoveryRevision: &revision}}
	if err = s.Reply(ctx, "node", "task.result", r); err != nil {
		t.Fatal(err)
	}
	e, err = s.Engine(ctx, "admin", "sing")
	if err != nil || e.ReenrollmentCheck != "" || e.LastError != "" || e.Status != "not_installed" {
		t.Fatal(e, err)
	}
}

func TestReenrollmentMigrationRepairsStaleObservations(t *testing.T) {
	s := engineFixture(t)
	ctx := context.Background()
	old, err := s.EngineAction(ctx, "admin", "sing", proxy.Action{Operation: "engine.stop", Confirm: true, IdempotencyKey: "legacy"})
	if err != nil {
		t.Fatal(err)
	}
	// Simulate the previous schema with a reset followed by a successful
	// observation for xray and a newer backup recovery pending for realm.
	if _, err = s.db.Exec(`ALTER TABLE subscription_restore_engines DROP COLUMN reason;
 ALTER TABLE engines DROP COLUMN last_absent_revision;
 INSERT INTO audit_logs(id,action,resource_type,resource_id,actor_id,created_at) VALUES('reset','node.enrollment.reset','node','node','admin','2026-01-02');
 UPDATE engines SET status='running',observed_at='2026-01-01';
 UPDATE engines SET observed_at='2026-01-03' WHERE id='xray';
 INSERT INTO subscription_restore_engines(engine_id,restored_at,state) VALUES('realm','2026-01-03','pending');`); err != nil {
		t.Fatal(err)
	}
	files, migration := migrations.Files, "0030_engine_reenrollment.up.sql"
	if s.postgres {
		files, migration = migrations.PostgresFiles, "postgres/0009_engine_reenrollment.up.sql"
	}
	sql, err := files.ReadFile(migration)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(string(sql)); err != nil {
		t.Fatal(err)
	}
	task, err := s.Task(ctx, old.ID)
	if err != nil || task.State != "failed" {
		t.Fatal(task, err)
	}
	for _, id := range []string{"realm", "xray", "sing"} {
		e, err := s.Engine(ctx, "admin", id)
		if err != nil {
			t.Fatal(err)
		}
		if id == "sing" && (e.ReenrollmentCheck != "pending" || e.Status != "unknown") || id != "sing" && e.ReenrollmentCheck != "" {
			t.Fatal(e)
		}
	}
	d, err := s.ClaimEngines(ctx, "node")
	if err != nil || d == nil || d.ResourceID != "sing" || !d.Engine.RecoveryCheck {
		t.Fatal(d, err)
	}
}
