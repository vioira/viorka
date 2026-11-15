package storage

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/proxy"
	"github.com/vioira/viorka/internal/subscription"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func restoredSubscriptionFixture(t *testing.T) (*Store, subscription.Subscription, string, v1.EngineCommand) {
	t.Helper()
	ctx := context.Background()
	s, edit := publishedSubscriptionFixture(t)
	item, _, err := s.SaveSubscription(ctx, "admin", "", edit)
	if err != nil {
		t.Fatal(err)
	}
	var encrypted string
	if err = s.db.QueryRow(`SELECT command_encrypted FROM engine_operations WHERE engine_id='sing' AND operation='engine.apply' ORDER BY revision DESC LIMIT 1`).Scan(&encrypted); err != nil {
		t.Fatal(err)
	}
	raw, err := s.openEngine("sing", encrypted)
	if err != nil {
		t.Fatal(err)
	}
	var current v1.EngineCommand
	if err = json.Unmarshal(raw, &current); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "restored.db")
	if err = s.Backup(ctx, path); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path+".engine-key", s.engineKey, 0600); err != nil {
		t.Fatal(err)
	}
	if err = PrepareRestoredSnapshot(ctx, path); err != nil {
		t.Fatal(err)
	}
	restored, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { restored.Close() })
	if err = restored.Online(ctx, "node", v1.Hello{OS: "linux", Arch: "amd64", Capabilities: []string{v1.EngineCapability}}); err != nil {
		t.Fatal(err)
	}
	item, err = restored.Subscription(ctx, "admin", item.ID)
	if err != nil {
		t.Fatal(err)
	}
	token, err := restored.RotateSubscription(ctx, "admin", item.ID, item.Version, false)
	if err != nil {
		t.Fatal(err)
	}
	return restored, item, token, current
}

func recoveryDispatch(t *testing.T, s *Store) *v1.TaskDispatch {
	t.Helper()
	ctx := context.Background()
	task, err := s.EngineAction(ctx, "admin", "sing", proxy.Action{Operation: "engine.inspect", RecoveryCheck: true, IdempotencyKey: "recovery-check", Confirm: true})
	if err != nil {
		t.Fatal(err)
	}
	dispatch, err := s.ClaimEngines(ctx, "node")
	if err != nil || dispatch == nil || dispatch.TaskID != task.ID || !dispatch.Engine.RecoveryCheck {
		t.Fatalf("recovery dispatch: %+v %v", dispatch, err)
	}
	return dispatch
}

func recoveryReply(d *v1.TaskDispatch, actual *v1.EngineCommand) v1.TaskReply {
	revision := actual.Revision
	return v1.TaskReply{TaskID: d.TaskID, ResourceID: d.ResourceID, Attempt: *d.Attempt, State: "succeeded", Engine: &v1.EngineResult{Name: d.Engine.Name, Version: d.Engine.Version, Revision: d.Engine.Revision, Status: "running", Recovery: &v1.EngineRecovery{EngineID: d.ResourceID, Command: actual, Status: "running"}, RecoveryRevision: &revision}}
}

func TestSubscriptionRecoveryMatchAndEndpointConfirmation(t *testing.T) {
	ctx := context.Background()
	s, _, token, actual := restoredSubscriptionFixture(t)
	d := recoveryDispatch(t, s)
	actual.Revision = d.Engine.Revision + 40 // The Agent is ahead of the restored Panel.
	r := recoveryReply(d, &actual)
	if err := s.Reply(ctx, "other", "task.result", r); !errors.Is(err, auth.ErrNotFound) {
		t.Fatalf("cross-node recovery result accepted: %v", err)
	}
	if err := s.Reply(ctx, "node", "task.result", r); err != nil {
		t.Fatal(err)
	}
	status, err := s.SubscriptionRecovery(ctx, "admin", "sing")
	if err != nil || status.State != "matched" || status.ObservedRevision != int64(actual.Revision) || status.DraftNeedsReview || len(status.Services) != 2 {
		t.Fatalf("recovery status: %+v %v", status, err)
	}
	if _, err = s.FetchSubscription(ctx, token, "clash-verge", ""); !errors.Is(err, subscription.ErrNoServices) {
		t.Fatalf("unconfirmed endpoint exported: %v", err)
	}
	if err = s.ConfirmSubscriptionEndpoint(ctx, "admin", "sing", "one", "example.net", 443, "example.net", 443, true); err != nil {
		t.Fatal(err)
	}
	result, err := s.FetchSubscription(ctx, token, "clash-verge", "")
	if err != nil || !strings.Contains(string(result.Body), actual.Services[0].Uuid) || strings.Contains(string(result.Body), actual.Services[1].Uuid) {
		t.Fatalf("wrong credential scope: %s %v", result.Body, err)
	}
	var taskResult, sealed string
	if err = s.db.QueryRow(`SELECT result_json FROM tasks WHERE id=?`, d.TaskID).Scan(&taskResult); err != nil {
		t.Fatal(err)
	}
	if err = s.db.QueryRow(`SELECT observed_encrypted FROM subscription_restore_engines WHERE engine_id='sing'`).Scan(&sealed); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(taskResult, actual.Services[0].Uuid) || strings.Contains(taskResult, actual.Services[0].PrivateKey) || strings.Contains(sealed, actual.Services[0].PrivateKey) {
		t.Fatal("recovery secret escaped encrypted storage")
	}
}

func TestSubscriptionRecoveryMismatchRequiresExplicitAdoption(t *testing.T) {
	ctx := context.Background()
	s, _, token, actual := restoredSubscriptionFixture(t)
	d := recoveryDispatch(t, s)
	actual.Revision = d.Engine.Revision + 10
	actual.Services[0].Uuid = "bf000d23-0752-40b4-affe-68f7707a9661"
	if err := s.Reply(ctx, "node", "task.result", recoveryReply(d, &actual)); err != nil {
		t.Fatal(err)
	}
	status, err := s.SubscriptionRecovery(ctx, "admin", "sing")
	if err != nil || status.State != "mismatch" || !status.Services[0].CredentialsChanged {
		t.Fatalf("mismatch not presented: %+v %v", status, err)
	}
	if _, err = s.FetchSubscription(ctx, token, "clash-verge", ""); !errors.Is(err, subscription.ErrNoServices) {
		t.Fatalf("mismatched credentials exported: %v", err)
	}
	if err = s.AdoptSubscriptionRecovery(ctx, "admin", "sing", d.TaskID, false); !errors.Is(err, subscription.ErrInvalid) {
		t.Fatalf("unconfirmed adoption accepted: %v", err)
	}
	if err = s.AdoptSubscriptionRecovery(ctx, "admin", "sing", "other-task", true); !errors.Is(err, subscription.ErrConflict) {
		t.Fatalf("wrong task adopted: %v", err)
	}
	if err = s.AdoptSubscriptionRecovery(ctx, "admin", "sing", d.TaskID, true); err != nil {
		t.Fatal(err)
	}
	status, err = s.SubscriptionRecovery(ctx, "admin", "sing")
	if err != nil || status.State != "matched" || !status.DraftNeedsReview {
		t.Fatalf("adoption did not preserve review requirement: %+v %v", status, err)
	}
	if _, err = s.EngineAction(ctx, "admin", "sing", proxy.Action{Operation: "engine.apply", DraftVersion: 1, IdempotencyKey: "stale", Confirm: true}); !errors.Is(err, proxy.ErrConflict) {
		t.Fatalf("stale restored draft could be applied: %v", err)
	}
	if err = s.ConfirmSubscriptionEndpoint(ctx, "admin", "sing", "one", "example.net", 443, "example.net", 443, true); err != nil {
		t.Fatal(err)
	}
	result, err := s.FetchSubscription(ctx, token, "clash-verge", "")
	if err != nil || !strings.Contains(string(result.Body), actual.Services[0].Uuid) {
		t.Fatalf("did not use current node credential: %s %v", result.Body, err)
	}
}

func TestSubscriptionRecoveryShowsServicesPublishedAfterRestore(t *testing.T) {
	ctx := context.Background()
	s, _, _, actual := restoredSubscriptionFixture(t)
	d := recoveryDispatch(t, s)
	if err := s.Reply(ctx, "node", "task.result", recoveryReply(d, &actual)); err != nil {
		t.Fatal(err)
	}
	engine, err := s.Engine(ctx, "admin", "sing")
	if err != nil {
		t.Fatal(err)
	}
	engine.Draft.Services = append(engine.Draft.Services, sampleService("three", 10443))
	draft := saveEngine(t, s, "sing", engine.Draft)
	apply := actionEngine(t, s, "sing", "post-restore-publish", "engine.apply", draft.Version)
	replyEngine(t, s, apply, "running")
	status, err := s.SubscriptionRecovery(ctx, "admin", "sing")
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, service := range status.Services {
		if service.ID == "three" && service.Enabled && service.PublicHost == "example.net" && !service.Confirmed {
			found = true
		}
	}
	if !found {
		t.Fatalf("newly published endpoint cannot be confirmed: %+v", status.Services)
	}
	if err = s.ConfirmSubscriptionEndpoint(ctx, "admin", "sing", "three", "example.net", 443, "example.net", 443, true); err != nil {
		t.Fatal(err)
	}
	items, _, err := s.SubscriptionCandidates(ctx, "admin", "", 20)
	if err != nil {
		t.Fatal(err)
	}
	found = false
	for _, item := range items {
		if item.ServiceID == "three" {
			found = true
		}
	}
	if !found {
		t.Fatal("confirmed newly published service was not selectable")
	}
}

func TestSubscriptionRecoveryCanAdoptAnEmptyManagedEngine(t *testing.T) {
	ctx := context.Background()
	s, _, token, actual := restoredSubscriptionFixture(t)
	d := recoveryDispatch(t, s)
	actual.Services = []*v1.EngineService{}
	actual.RunIntent = "stopped"
	reply := recoveryReply(d, &actual)
	reply.Engine.Status = "stopped"
	reply.Engine.Recovery.Status = "stopped"
	if err := s.Reply(ctx, "node", "task.result", reply); err != nil {
		t.Fatal(err)
	}
	status, err := s.SubscriptionRecovery(ctx, "admin", "sing")
	if err != nil || status.State != "mismatch" {
		t.Fatalf("empty node state was not presented for review: %+v %v", status, err)
	}
	if err = s.AdoptSubscriptionRecovery(ctx, "admin", "sing", d.TaskID, true); err != nil {
		t.Fatal(err)
	}
	status, err = s.SubscriptionRecovery(ctx, "admin", "sing")
	if err != nil || status.State != "matched" || !status.DraftNeedsReview || len(status.Services) != 0 {
		t.Fatalf("empty state was not adopted: %+v %v", status, err)
	}
	if _, err = s.FetchSubscription(ctx, token, "clash-verge", ""); !errors.Is(err, subscription.ErrNoServices) {
		t.Fatalf("removed service remained exportable: %v", err)
	}
}
