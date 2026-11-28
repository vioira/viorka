package storage

import (
	"context"
	"errors"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/vioira/viorka/internal/proxy"
	"github.com/vioira/viorka/internal/relayprobe"
	"github.com/vioira/viorka/internal/subscription"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func relayFixture(t *testing.T) (*Store, proxy.RelayRoute, subscription.Edit) {
	t.Helper()
	s, edit := publishedSubscriptionFixture(t)
	if _, err := s.db.Exec(`UPDATE engines SET node_id='other' WHERE id='realm'`); err != nil {
		t.Fatal(err)
	}
	landing, err := s.RelayLanding(t.Context(), "admin", "sing", "one")
	if err != nil {
		t.Fatal(err)
	}
	draft := proxy.RelayEdit{Name: "香港入口", EngineID: "realm", LandingEngineID: "sing", LandingServiceID: "one", LandingRevision: landing.LandingRevision, Public: proxy.Endpoint{Host: "relay.example", Port: 30443}, Listen: proxy.Endpoint{Host: "10.0.0.8", Port: 10043}}
	r, err := s.SaveRelay(t.Context(), "admin", "", draft)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(`INSERT INTO port_allocations(id,node_id,public_host,public_port,private_host,private_port,transport,owner,created_at) VALUES('fixture-public','other','93.184.216.34',30443,'10.0.0.8',10043,'tcp','provider',?)`, now()); err != nil {
		t.Fatal(err)
	}
	return s, r, edit
}
func passPublicProbe(t *testing.T, s *Store, r proxy.RelayRoute) {
	t.Helper()
	j, err := s.claimPublicProbe(t.Context())
	ip := netip.MustParseAddr("93.184.216.34")
	if err != nil || j == nil || j.route != r.ID || j.revision != r.TargetRevision || j.target.Endpoint != r.Published.Public || !j.target.Allows(ip) {
		t.Fatalf("unexpected public probe %+v: %v", j, err)
	}
	if err = s.finishPublicProbe(t.Context(), *j, relayprobe.Result{State: "passed", Source: "external", IP: ip}); err != nil {
		t.Fatal(err)
	}
}
func reviewRelay(r proxy.RelayRoute, key string) proxy.RelayPublishRequest {
	return proxy.RelayPublishRequest{RelayAction: proxy.RelayAction{Version: r.Draft.Version, RequestKey: key}, Review: r.PublishBase}
}
func replyRelay(t *testing.T, s *Store, task string, expected int, status string) {
	t.Helper()
	d, err := s.ClaimEngines(t.Context(), "other")
	if err != nil || d == nil || task != d.TaskID || len(d.Engine.Services) != expected || d.Engine.AllowUnreachable {
		t.Fatalf("unexpected dispatch %+v, %v", d, err)
	}
	for _, v := range d.Engine.Services {
		if v.PrivateKey != "" || v.Uuid != "" {
			t.Fatal("landing credential dispatched")
		}
	}
	reply := v1.TaskReply{TaskID: task, ResourceID: d.ResourceID, Attempt: *d.Attempt, State: "succeeded", Engine: &v1.EngineResult{Name: "realm", Version: d.Engine.Version, Revision: d.Engine.Revision, Status: status}}
	if err = s.ReplyEngine(t.Context(), "other", "task.result", reply); err != nil {
		t.Fatal(err)
	}
}
func TestRelayPublicationAndWithdrawal(t *testing.T) {
	ctx := t.Context()
	s, r, edit := relayFixture(t)
	action := reviewRelay(r, "publish")
	task, err := s.PublishRelay(ctx, "admin", r.ID, action)
	if err != nil {
		t.Fatal(err)
	}
	same, err := s.PublishRelay(ctx, "admin", r.ID, action)
	if err != nil || same.ID != task.ID {
		t.Fatal("duplicate task", err)
	}
	replyRelay(t, s, task.ID, 1, "running")
	r, err = s.RelayRoute(ctx, "admin", r.ID)
	if err != nil || r.Reason != "awaiting_public" {
		t.Fatalf("route %+v: %v", r, err)
	}

	passPublicProbe(t, s, r)
	unchanged, err := s.SaveRelay(ctx, "admin", r.ID, r.Draft.RelayEdit)
	if err != nil || unchanged.Draft.Version != r.Draft.Version || unchanged.Reason != "available" {
		t.Fatal("unchanged edit disturbed publication", unchanged, err)
	}
	if _, err := s.PublishRelay(ctx, "admin", r.ID, reviewRelay(unchanged, "duplicate")); !errors.Is(err, proxy.ErrRelayApplied) {
		t.Fatal("identical publish could invalidate public verification", err)
	}
	candidates, _, err := s.SubscriptionCandidates(ctx, "admin", "", 20, "香港")
	if err != nil || len(candidates) != 1 || candidates[0].EntryType != "relay" {
		t.Fatal(candidates, err)
	}
	edit.Services = []subscription.ServiceRef{candidates[0].ServiceRef}
	loon, err := s.SaveSubscriptionRule(ctx, "admin", "", subscription.RuleEdit{Name: "线路 Loon", TemplateID: "loon", Enabled: true, Position: 40, Conditions: []subscription.Condition{{Kind: "contains", Pattern: "Loon"}}})
	if err != nil {
		t.Fatal(err)
	}
	edit.RuleIDs = append(edit.RuleIDs, loon.ID)
	_, token, err := s.SaveSubscription(ctx, "admin", "", edit)
	if err != nil {
		t.Fatal(err)
	}
	for _, format := range []string{"mihomo", "sing-box", "loon"} {
		out, err := s.FetchSubscription(ctx, token, "client", format)
		if err != nil || !strings.Contains(string(out.Body), "relay.example") || strings.Contains(string(out.Body), "example.net") {
			t.Fatalf("relay selection rendered incorrect endpoint for %s: %v", format, err)
		}
	}
	if _, err = s.db.Exec(`UPDATE engines SET status='stopped' WHERE id='sing'`); err != nil {
		t.Fatal(err)
	}
	if _, err = s.FetchSubscription(ctx, token, "client", "mihomo"); !errors.Is(err, subscription.ErrNoServices) {
		t.Fatal("stopped landing remained eligible", err)
	}
	if _, err = s.db.Exec(`UPDATE engines SET status='running' WHERE id='sing'`); err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(`UPDATE nodes SET state='offline' WHERE id='other'`); err != nil {
		t.Fatal(err)
	}
	stop, err := s.WithdrawRelay(ctx, "admin", r.ID, proxy.RelayAction{Version: 1, RequestKey: "withdraw"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.FetchSubscription(ctx, token, "client", "mihomo"); !errors.Is(err, subscription.ErrNoServices) {
		t.Fatal("disabled route fell back", err)
	}
	if _, err = s.db.Exec(`UPDATE nodes SET state='online' WHERE id='other'`); err != nil {
		t.Fatal(err)
	}
	replyRelay(t, s, stop.ID, 0, "stopped")
	r, err = s.RelayRoute(ctx, "admin", r.ID)
	if err != nil || r.RemovedAt == "" || r.StoppedAt == "" {
		t.Fatal(r, err)
	}
	if err = s.DeleteRelay(ctx, "admin", r.ID, 1); err != nil {
		t.Fatal(err)
	}
	if _, err = s.FetchSubscription(ctx, token, "client", "mihomo"); !errors.Is(err, subscription.ErrNoServices) {
		t.Fatal("removed route fell back", err)
	}
}
func TestRelayConcurrentEditsAndLatePublish(t *testing.T) {
	ctx := context.Background()
	s, r, _ := relayFixture(t)
	second := r.Draft.RelayEdit
	second.Name = "备用入口"
	second.Version = 0
	second.Listen.Port++
	second.Public.Port++
	other, err := s.SaveRelay(ctx, "admin", "", second)
	if err != nil {
		t.Fatal(err)
	}
	a := reviewRelay(r, "first")
	applying, err := s.PublishRelay(ctx, "admin", r.ID, a)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.PublishRelay(ctx, "admin", other.ID, a); !errors.Is(err, proxy.ErrRelayRevision) {
		t.Fatal("stale instance accepted", err)
	}
	if _, err = s.SaveEngineDraft(ctx, "admin", "realm", proxy.Draft{Version: 1, Services: []proxy.Service{}}); !errors.Is(err, proxy.ErrRelayRule) {
		t.Fatal("managed rule overwritten", err)
	}
	removing, err := s.WithdrawRelay(ctx, "admin", r.ID, proxy.RelayAction{Version: 1, RequestKey: "stop"})
	if err != nil {
		t.Fatal(err)
	}
	replyRelay(t, s, applying.ID, 1, "running")
	view, err := s.RelayRoute(ctx, "admin", r.ID)
	if err != nil || view.Reason != "disabled" || view.RemovedAt != "" {
		t.Fatal("late report changed eligibility", view, err)
	}
	replyRelay(t, s, removing.ID, 0, "stopped")
}

// Both kinds of retest observe the publication that is already in effect.
func assertRelayProbeVersions(t *testing.T, s *Store, published proxy.RelayRoute) {
	t.Helper()
	current, err := s.RelayRoute(t.Context(), "admin", published.ID)
	if err != nil {
		t.Fatal(err)
	}
	engine := engineAt(t, s, published.Draft.EngineID)
	want := published.TargetRevision
	if current.TargetRevision != want || engine.DesiredRevision != want || engine.PublishedRevision != want || engine.ObservedRevision != want {
		t.Fatalf("probe changed revisions: route=%d desired=%d published=%d observed=%d, want %d", current.TargetRevision, engine.DesiredRevision, engine.PublishedRevision, engine.ObservedRevision, want)
	}
	var newer int
	if err := s.db.QueryRow(`SELECT count(*) FROM config_revisions WHERE resource_kind='engine' AND resource_id=? AND revision>?`, engine.ID, want).Scan(&newer); err != nil {
		t.Fatal(err)
	}
	if newer != 0 {
		t.Fatalf("probe created %d configuration revisions", newer)
	}
}

func TestRelayProbeCapabilityRevisionAndTransientFailure(t *testing.T) {
	s, r, _ := relayFixture(t)
	ctx := t.Context()
	publish, err := s.PublishRelay(ctx, "admin", r.ID, reviewRelay(r, "publish"))
	if err != nil {
		t.Fatal(err)
	}
	replyRelay(t, s, publish.ID, 1, "running")
	r, err = s.RelayRoute(ctx, "admin", r.ID)
	if err != nil {
		t.Fatal(err)
	}

	passPublicProbe(t, s, r)
	input := proxy.RelayAction{Version: r.TargetRevision, RequestKey: "check"}
	if _, err = s.ProbeRelay(ctx, "admin", r.ID, input); !errors.Is(err, proxy.ErrUnavailable) {
		t.Fatal("legacy agent accepted", err)
	}
	if _, err = s.db.Exec(`UPDATE nodes SET relay_probe_capable=1 WHERE id='other'`); err != nil {
		t.Fatal(err)
	}
	task, err := s.ProbeRelay(ctx, "admin", r.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	assertRelayProbeVersions(t, s, r)
	if d, err := s.ClaimEngines(ctx, "other"); err != nil || d != nil {
		t.Fatal("unnegotiated probe dispatched", d, err)
	}
	d, err := s.ClaimNegotiatedEngines(ctx, "other", false, true)
	if err != nil || d == nil || d.TaskID != task.ID || d.Engine.RelayProbe == nil {
		t.Fatal("missing probe", d, err)
	}
	result := v1.TaskReply{TaskID: d.TaskID, ResourceID: "realm", Attempt: *d.Attempt, State: "succeeded", Engine: &v1.EngineResult{Name: "realm", Version: d.Engine.Version, Revision: d.Engine.Revision, Status: "running", RelayProbe: &v1.RelayProbeResult{RuleID: "wrong", AppliedRevision: uint64(r.ObservedRevision), Listen: "passed", Dial: "timeout"}}}
	if err = s.ReplyEngine(ctx, "other", "task.result", result); err == nil {
		t.Fatal("foreign check stored")
	}
	result.Engine.RelayProbe.RuleID = r.ID
	if err = s.ReplyEngine(ctx, "other", "task.result", result); err != nil {
		t.Fatal(err)
	}
	current, err := s.RelayRoute(ctx, "admin", r.ID)
	if err != nil || current.Reason != "available" || current.Probe == nil || current.Probe.Dial != "timeout" {
		t.Fatal("transient failure changed eligibility", current, err)
	}
	assertRelayProbeVersions(t, s, r)
	input.RequestKey = "too-soon"
	if _, err = s.ProbeRelay(ctx, "admin", r.ID, input); !errors.Is(err, proxy.ErrConflict) {
		t.Fatal("probe cooldown missing", err)
	}
	// The Agent distinguishes a failed file/revision check from an ordinary dial timeout.
	if _, err = s.db.Exec(`UPDATE tasks SET created_at=? WHERE id=?`, at(time.Now().Add(-2*time.Minute)), task.ID); err != nil {
		t.Fatal(err)
	}
	task, err = s.ProbeRelay(ctx, "admin", r.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	d, err = s.ClaimNegotiatedEngines(ctx, "other", false, true)
	if err != nil || d == nil {
		t.Fatal(err)
	}
	const code = "engine_result_unknown"
	failProbe := func(dispatch *v1.TaskDispatch) {
		t.Helper()
		reply := v1.TaskReply{
			TaskID: dispatch.TaskID, ResourceID: dispatch.ResourceID, Attempt: *dispatch.Attempt,
			State: "failed", ErrorCode: code,
			Engine: &v1.EngineResult{Name: "realm", Version: dispatch.Engine.Version, Revision: dispatch.Engine.Revision, Status: "running", ErrorCode: code},
		}
		if err := s.ReplyEngine(ctx, "other", "task.result", reply); err != nil {
			t.Fatal(err)
		}
	}
	failProbe(d)
	current, err = s.RelayRoute(ctx, "admin", r.ID)
	if err != nil || current.Reason != "probe_unconfirmed" || current.ServingRevision != 0 {
		t.Fatal("unconfirmed active files still exported", current, err)
	}
	assertRelayProbeVersions(t, s, r)
	// Withdrawal may reserve the next configuration revision during a probe.
	// A late diagnostic failure must not mark that withdrawal as failed.
	if _, err = s.db.Exec(`UPDATE tasks SET created_at=? WHERE id=?`, at(time.Now().Add(-2*time.Minute)), task.ID); err != nil {
		t.Fatal(err)
	}
	input.RequestKey = "probe-before-withdraw"
	task, err = s.ProbeRelay(ctx, "admin", r.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	d, err = s.ClaimNegotiatedEngines(ctx, "other", false, true)
	if err != nil || d == nil || d.TaskID != task.ID {
		t.Fatal("missing probe before withdrawal", err)
	}
	withdraw, err := s.WithdrawRelay(ctx, "admin", r.ID, proxy.RelayAction{Version: r.Draft.Version, RequestKey: "withdraw"})
	if err != nil {
		t.Fatal(err)
	}
	failProbe(d)
	if engine := engineAt(t, s, "realm"); engine.SyncError != "" {
		t.Fatalf("probe failure attached to withdrawal: %s", engine.SyncError)
	}
	replyRelay(t, s, withdraw.ID, 0, "stopped")
	if engine := engineAt(t, s, "realm"); engine.ObservedRevision != r.TargetRevision+1 {
		t.Fatalf("next applied revision after probes: got %d, want %d", engine.ObservedRevision, r.TargetRevision+1)
	}
}
func TestRelaySwitchPausesBeforeDispatch(t *testing.T) {
	ctx := t.Context()
	s, r, edit := relayFixture(t)
	task, err := s.PublishRelay(ctx, "admin", r.ID, reviewRelay(r, "first"))
	if err != nil {
		t.Fatal(err)
	}
	replyRelay(t, s, task.ID, 1, "running")
	r, err = s.RelayRoute(ctx, "admin", r.ID)
	if err != nil {
		t.Fatal(err)
	}
	stale, err := s.claimPublicProbe(ctx)
	if err != nil || stale == nil {
		t.Fatal(err)
	}
	result := relayprobe.Result{State: "passed", Source: "external", IP: netip.MustParseAddr("93.184.216.34")}
	if err = s.finishPublicProbe(ctx, *stale, result); err != nil {
		t.Fatal(err)
	}
	edit.Services = []subscription.ServiceRef{{NodeID: "other", EngineID: "realm", ServiceID: r.ID}}
	_, token, err := s.SaveSubscription(ctx, "admin", "", edit)
	if err != nil {
		t.Fatal(err)
	}
	next := r.Draft.RelayEdit

	next.LandingServiceID = "two"
	updated, err := s.SaveRelay(ctx, "admin", r.ID, next)
	if err != nil || updated.Reason != "available" {
		t.Fatal("draft disrupted publication", updated, err)
	}
	task, err = s.PublishRelay(ctx, "admin", r.ID, reviewRelay(updated, "switch"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.FetchSubscription(ctx, token, "client", "mihomo"); !errors.Is(err, subscription.ErrNoServices) {
		t.Fatal("old path outlived switch", err)
	}
	replyRelay(t, s, task.ID, 1, "running")
	if err = s.finishPublicProbe(ctx, *stale, result); err != nil {
		t.Fatal("old verification accepted", err)
	}
	if _, err = s.FetchSubscription(ctx, token, "client", "mihomo"); !errors.Is(err, subscription.ErrNoServices) {
		t.Fatal("unverified switch exported", err)
	}
}

func TestRelayKeepsUnpublishedManualRule(t *testing.T) {
	ctx := t.Context()
	s, r, _ := relayFixture(t)
	manual := proxy.Service{ID: "manual", Name: "manual", Enabled: true, ListenHost: "0.0.0.0", ListenPort: 13800, TargetHost: "private.example", TargetPort: 80}
	saveEngine(t, s, "realm", proxy.Draft{Services: []proxy.Service{manual}})
	next := r.Draft.RelayEdit

	r, err := s.SaveRelay(ctx, "admin", r.ID, next)
	if err != nil {
		t.Fatal(err)
	}
	task, err := s.PublishRelay(ctx, "admin", r.ID, reviewRelay(r, "apply"))
	if err != nil {
		t.Fatal(err)
	}
	replyRelay(t, s, task.ID, 1, "running")
	engine, err := s.Engine(ctx, "admin", "realm")
	if err != nil || len(engine.Draft.Services) != 2 || engine.Draft.Services[0] != manual || len(engine.PublishedDraft.Services) != 1 || engine.PublishedDraft.Services[0].ID != r.ID {
		t.Fatal("unrelated local edits lost or published", engine.Draft, err)
	}
}

func TestRelayDraftCreationRequiresEntryManagementAndLandingExport(t *testing.T) {
	ctx := t.Context()
	s, original, _ := relayFixture(t)
	edit := original.Draft.RelayEdit
	edit.Version = 0
	edit.Name = "操作员草稿"
	for _, tc := range []struct{ manage, export bool }{{false, true}, {true, false}, {true, true}} {
		if err := s.SetEngineGrant(ctx, "admin", "other", proxy.Grant{UserID: "operator", CanManage: tc.manage}); err != nil {
			t.Fatal(err)
		}
		if err := s.SetEngineGrant(ctx, "admin", "node", proxy.Grant{UserID: "operator", CanExport: tc.export}); err != nil {
			t.Fatal(err)
		}
		draft, err := s.SaveRelay(ctx, "operator", "", edit)
		if !tc.manage || !tc.export {
			if !errors.Is(err, proxy.ErrForbidden) {
				t.Fatalf("manage=%v export=%v: %v", tc.manage, tc.export, err)
			}
			continue
		}
		if err != nil || draft.Draft.Version != 1 || draft.Reason != "draft" || draft.TaskID != "" || draft.ServingRevision != 0 {
			t.Fatalf("expected an unpublished draft: %+v, %v", draft, err)
		}
	}
}

func TestRelayCleanupAfterLandingGrantLoss(t *testing.T) {
	ctx := t.Context()
	s, r, edit := relayFixture(t)
	for _, node := range []string{"node", "other"} {
		if err := s.SetEngineGrant(ctx, "admin", node, proxy.Grant{UserID: "operator", CanManage: node == "other", CanExport: true}); err != nil {
			t.Fatal(err)
		}
	}
	task, err := s.PublishRelay(ctx, "operator", r.ID, reviewRelay(r, "publish"))
	if err != nil {
		t.Fatal(err)
	}
	replyRelay(t, s, task.ID, 1, "running")
	r, err = s.RelayRoute(ctx, "operator", r.ID)
	if err != nil {
		t.Fatal(err)
	}

	passPublicProbe(t, s, r)
	edit.Services = append(edit.Services, subscription.ServiceRef{NodeID: "other", EngineID: "realm", ServiceID: r.ID})
	_, token, err := s.SaveSubscription(ctx, "operator", "", edit)
	if err != nil {
		t.Fatal(err)
	}
	out, err := s.FetchSubscription(ctx, token, "client", "mihomo")
	if err != nil || !strings.Contains(string(out.Body), "relay.example") || !strings.Contains(string(out.Body), "example.net") {
		t.Fatal("missing selected entries", err)
	}
	if err = s.SetEngineGrant(ctx, "admin", "node", proxy.Grant{UserID: "operator"}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.FetchSubscription(ctx, token, "client", "mihomo"); !errors.Is(err, subscription.ErrForbidden) {
		t.Fatal("owner permission failure was not enforced", err)
	}
	view, err := s.RelayRoute(ctx, "operator", r.ID)
	if err != nil || !view.CleanupOnly || view.Published != nil || view.Draft.LandingEngineID != "" {
		t.Fatal("revoked information exposed", view, err)
	}
	if _, err = s.WithdrawRelay(ctx, "operator", r.ID, proxy.RelayAction{Version: r.Draft.Version, RequestKey: "cleanup"}); err != nil {
		t.Fatal(err)
	}
}

func TestRelayRestoredBackupRetainsHistoryAndIsolatesDistribution(t *testing.T) {
	ctx := t.Context()
	s, r, edit := relayFixture(t)
	task, err := s.PublishRelay(ctx, "admin", r.ID, reviewRelay(r, "publish"))
	if err != nil {
		t.Fatal(err)
	}
	replyRelay(t, s, task.ID, 1, "running")
	r, err = s.RelayRoute(ctx, "admin", r.ID)
	if err != nil {
		t.Fatal(err)
	}

	passPublicProbe(t, s, r)
	edit.Services = []subscription.ServiceRef{{NodeID: "other", EngineID: "realm", ServiceID: r.ID}}
	item, old, err := s.SaveSubscription(ctx, "admin", "", edit)
	if err != nil {
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
	defer restored.Close()
	if _, err = restored.FetchSubscription(ctx, old, "client", "mihomo"); !errors.Is(err, subscription.ErrNotFound) {
		t.Fatal("old token survived", err)
	}
	r, err = restored.RelayRoute(ctx, "admin", r.ID)
	if err != nil || r.Reason != "restore_verification_required" || r.ServingRevision != 0 {
		t.Fatal("missing isolation or history", r, err)
	}
	var history int
	if err = restored.db.QueryRow(`SELECT count(*) FROM relay_public_probes WHERE route_id=? AND state='passed' AND epoch=''`, r.ID).Scan(&history); err != nil || history != 1 {
		t.Fatal("missing restored probe history", history, err)
	}
	item, err = restored.Subscription(ctx, "admin", item.ID)
	if err != nil {
		t.Fatal(err)
	}
	token, err := restored.RotateSubscription(ctx, "admin", item.ID, item.Version, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = restored.FetchSubscription(ctx, token, "client", "mihomo"); !errors.Is(err, subscription.ErrNoServices) {
		t.Fatal("restored selection fell back", err)
	}
	for _, identity := range []struct{ node, engine string }{{"node", "sing"}, {"other", "realm"}} {
		// Use the exact immutable command held by the simulated Agent before restore.
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		actual, err := s.readTarget(ctx, tx, identity.engine)
		tx.Rollback()
		if err != nil {
			t.Fatal(err)
		}
		if err = restored.Online(ctx, identity.node, v1.Hello{OS: "linux", Arch: "amd64", Capabilities: []string{v1.EngineCapability, v1.EngineRecoveryCapability}}); err != nil {
			t.Fatal(err)
		}
		check, err := restored.EngineAction(ctx, "admin", identity.engine, proxy.Action{Operation: "engine.inspect", RecoveryCheck: true, IdempotencyKey: "recover-" + identity.engine, Confirm: true})
		if err != nil {
			t.Fatal(err)
		}
		dispatch, err := restored.ClaimEngines(ctx, identity.node)
		if err != nil || dispatch == nil || dispatch.TaskID != check.ID {
			t.Fatal("missing recovery dispatch", dispatch, err)
		}
		if err = restored.Reply(ctx, identity.node, "task.result", recoveryReply(dispatch, &actual.Command)); err != nil {
			t.Fatal(err)
		}
	}
	if err = restored.ConfirmSubscriptionEndpoint(ctx, "admin", "sing", "one", "example.net", 443, "example.net", 443, true); err != nil {
		t.Fatal(err)
	}
	r, err = restored.RelayRoute(ctx, "admin", r.ID)
	if err != nil || r.Reason != "awaiting_public" {
		t.Fatal("backup verification was reused or matched rules lost", r.Reason, err)
	}

	passPublicProbe(t, restored, r)
	reply, err := restored.FetchSubscription(ctx, token, "client", "mihomo")
	if err != nil || !strings.Contains(string(reply.Body), "relay.example") {
		t.Fatal("matched and reverified path missing after restore", err)
	}

}

func TestRelayFailedSwitchUsesOnlyConfirmedRollback(t *testing.T) {
	for _, tc := range []struct {
		code, status string
		available    bool
	}{{"engine_start_failed", "running", true}, {"engine_rollback_failed", "degraded", false}} {
		t.Run(tc.code, func(t *testing.T) {
			ctx := t.Context()
			s, r, edit := relayFixture(t)
			task, err := s.PublishRelay(ctx, "admin", r.ID, reviewRelay(r, "first"))
			if err != nil {
				t.Fatal(err)
			}
			replyRelay(t, s, task.ID, 1, "running")
			r, err = s.RelayRoute(ctx, "admin", r.ID)
			if err != nil {
				t.Fatal(err)
			}

			passPublicProbe(t, s, r)
			edit.Services = []subscription.ServiceRef{{NodeID: "other", EngineID: "realm", ServiceID: r.ID}}
			_, token, err := s.SaveSubscription(ctx, "admin", "", edit)
			if err != nil {
				t.Fatal(err)
			}
			before, err := s.FetchSubscription(ctx, token, "client", "mihomo")
			if err != nil {
				t.Fatal(err)
			}
			next := r.Draft.RelayEdit
			next.LandingServiceID = "two"

			draft, err := s.SaveRelay(ctx, "admin", r.ID, next)
			if err != nil {
				t.Fatal(err)
			}
			task, err = s.PublishRelay(ctx, "admin", r.ID, reviewRelay(draft, "switch"))
			if err != nil {
				t.Fatal(err)
			}
			dispatch, err := s.ClaimEngines(ctx, "other")
			if err != nil || dispatch == nil || dispatch.TaskID != task.ID {
				t.Fatal(dispatch, err)
			}
			err = s.ReplyEngine(ctx, "other", "task.result", v1.TaskReply{TaskID: task.ID, ResourceID: "realm", State: "failed", Attempt: *dispatch.Attempt, ErrorCode: tc.code, Engine: &v1.EngineResult{Name: "realm", Version: dispatch.Engine.Version, Revision: dispatch.Engine.Revision, Status: tc.status, ErrorCode: tc.code}})
			if err != nil {
				t.Fatal(err)
			}
			current, err := s.RelayRoute(ctx, "admin", r.ID)
			if err != nil {
				t.Fatal(err)
			}
			after, err := s.FetchSubscription(ctx, token, "client", "mihomo")
			if tc.available {
				if err != nil || current.ServingPath == nil || current.ServingPath.LandingServiceID != "one" || current.Published.LandingServiceID != "two" || current.ServingRevision != r.TargetRevision || string(after.Body) != string(before.Body) {
					t.Fatal("restored path/credentials did not match", current, err)
				}
			} else if !errors.Is(err, subscription.ErrNoServices) || current.ServingRevision != 0 {
				t.Fatal("unknown rollback remained eligible", current, err)
			}
		})
	}
}

func TestRelayPeriodicProbeUsesCurrentGrantAndCooldown(t *testing.T) {
	ctx := t.Context()
	s, r, _ := relayFixture(t)
	task, err := s.PublishRelay(ctx, "admin", r.ID, reviewRelay(r, "publish"))
	if err != nil {
		t.Fatal(err)
	}
	replyRelay(t, s, task.ID, 1, "running")
	r, err = s.RelayRoute(ctx, "admin", r.ID)
	if err != nil {
		t.Fatal(err)
	}

	passPublicProbe(t, s, r)
	if _, err = s.db.Exec(`UPDATE nodes SET relay_probe_capable=1 WHERE id='other'`); err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(`UPDATE config_revisions SET created_at=? WHERE resource_id='realm'`, at(time.Now().Add(-31*time.Minute))); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err = s.ScheduleRelayProbes(ctx, time.Now()); err != nil {
			t.Fatal(err)
		}
	}
	var n int
	if err = s.db.QueryRow(`SELECT count(*) FROM relay_probe_tasks WHERE route_id=?`, r.ID).Scan(&n); err != nil || n != 1 {
		t.Fatal("periodic check was not enqueued exactly once", n, err)
	}
}

func TestRelayConcurrentPublicMappingClaims(t *testing.T) {
	ctx := t.Context()
	s, first, _ := relayFixture(t)
	if _, err := s.db.Exec(`INSERT INTO engines(id,node_id,name,version,ownership,status) VALUES('realm2','node','realm','2.9.6','managed','installed')`); err != nil {
		t.Fatal(err)
	}
	other := first.Draft.RelayEdit
	other.EngineID = "realm2"
	other.Version = 0
	other.Listen = proxy.Endpoint{Host: "10.0.0.9", Port: 11043}
	second, err := s.SaveRelay(ctx, "admin", "", other)
	if err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	results := make(chan error, 2)
	for _, r := range []proxy.RelayRoute{first, second} {
		go func() {
			<-start
			_, err := s.PublishRelay(ctx, "admin", r.ID, reviewRelay(r, "claim"))
			results <- err
		}()
	}
	close(start)
	won, conflicts := 0, 0
	for range 2 {
		switch err := <-results; {
		case err == nil:
			won++
		case errors.Is(err, proxy.ErrRelayMapping):
			conflicts++
		default:
			t.Fatalf("unexpected result: %v", err)
		}
	}
	var bindings, published int
	if err = s.db.QueryRow(`SELECT (SELECT count(*) FROM relay_public_bindings),(SELECT count(*) FROM relay_publications)`).Scan(&bindings, &published); err != nil || won != 1 || conflicts != 1 || bindings != 1 || published != 1 {
		t.Fatal("mapping ownership or task commit was not atomic", won, conflicts, bindings, published, err)
	}
}

func TestRelayPublishReviewsCurrentInstanceWithoutRewritingRoute(t *testing.T) {
	ctx := t.Context()
	s, route, _ := relayFixture(t)
	if _, err := s.db.Exec("UPDATE engines SET status='running' WHERE id='realm'"); err != nil {
		t.Fatal(err)
	}
	route, err := s.RelayRoute(ctx, "admin", route.ID)
	if err != nil {
		t.Fatal(err)
	}
	initial := reviewRelay(route, "review")
	if _, err := s.db.Exec("UPDATE engines SET status='stopped',run_intent='stopped' WHERE id='realm'"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.PublishRelay(ctx, "admin", route.ID, initial); !errors.Is(err, proxy.ErrRelayRevision) {
		t.Fatalf("unreviewed start: %v", err)
	}
	manual := proxy.Service{ID: "manual", Name: "manual", Enabled: true, ListenHost: "0.0.0.0", ListenPort: 16000, TargetHost: "example.net", TargetPort: 443}
	saveEngine(t, s, "realm", proxy.Draft{Services: []proxy.Service{manual}})
	current, err := s.RelayRoute(ctx, "admin", route.ID)
	if err != nil || current.Draft.Version != route.Draft.Version || current.PublishBase == nil || !current.PublishBase.StartsRealm || current.PublishBase.DraftVersion == initial.Review.DraftVersion {
		t.Fatal(current, err)
	}
	task, err := s.PublishRelay(ctx, "admin", route.ID, reviewRelay(current, "review"))
	if err != nil {
		t.Fatal(err)
	}
	replyRelay(t, s, task.ID, 1, "running")
	entry, err := s.Engine(ctx, "admin", "realm")
	if err != nil || entry.RunIntent != "running" || len(entry.Draft.Services) != 2 || len(entry.PublishedDraft.Services) != 1 {
		t.Fatal(entry, err)
	}
}

func TestRelayLandingSelection(t *testing.T) {
	ctx := t.Context()
	s, _, _ := relayFixture(t)
	first, cursor, err := s.RelayLandings(ctx, "admin", "", 1, "")
	if err != nil || len(first) != 1 || cursor == "" {
		t.Fatal(first, cursor, err)
	}
	next, _, err := s.RelayLandings(ctx, "admin", cursor, 1, "")
	if err != nil || len(next) != 1 || first[0].ServiceRef == next[0].ServiceRef {
		t.Fatal(next, err)
	}
	denied, _, err := s.RelayLandings(ctx, "operator", "", 20, "")
	if err != nil || len(denied) != 0 {
		t.Fatal(denied, err)
	}
	if _, err := s.db.Exec("UPDATE engines SET status='stopped' WHERE id='sing'"); err != nil {
		t.Fatal(err)
	}
	items, _, err := s.RelayLandings(ctx, "admin", "", 20, "")
	if err != nil || len(items) != 0 {
		t.Fatal(items, err)
	}
	direct, _, err := s.SubscriptionCandidates(ctx, "admin", "", 20, "")
	if err != nil || len(direct) == 0 {
		t.Fatal("ordinary subscription eligibility changed", err)
	}
}

func TestRelayProviderMappingAcceptsMatchingWildcard(t *testing.T) {
	ctx := t.Context()
	s, r, _ := relayFixture(t)
	edit := r.Draft.RelayEdit
	if _, err := s.db.Exec(`INSERT INTO port_allocations(id,node_id,public_host,public_port,private_host,private_port,transport,owner,created_at) VALUES('nat','other','relay.example',30443,'10.0.0.8',10043,'tcp','provider','now')`); err != nil {
		t.Fatal(err)
	}
	edit.Listen.Host = "10.0.0.9"
	if _, err := s.SaveRelay(ctx, "admin", r.ID, edit); !errors.Is(err, proxy.ErrRelayMapping) {
		t.Fatal(err)
	}
	edit.Listen.Host = "0.0.0.0"
	saved, err := s.SaveRelay(ctx, "admin", r.ID, edit)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.PublishRelay(ctx, "admin", r.ID, reviewRelay(saved, "mapped")); err != nil {
		t.Fatal(err)
	}
}
