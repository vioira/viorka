package storage

import (
	"context"
	"errors"
	"testing"

	"github.com/vioira/viorka/internal/proxy"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func syncPreset(t *testing.T, s *Store) proxy.Preset {
	t.Helper()
	p, err := s.CreateProtocolPreset(context.Background(), "admin", proxy.PresetConfig{Name: "Shared", Protocol: "vless", Port: 8443, Transport: "tcp", Security: "reality", Site: "external", Target: "example.com:443", ServerName: "example.com", Fingerprint: "chrome", ShortIDs: []string{"aabb"}})
	if err != nil {
		t.Fatal(err)
	}
	return p
}
func publishPreset(t *testing.T, s *Store, p proxy.Preset, id string, port *int, sni *string) *v1.TaskDispatch {
	t.Helper()
	v := sampleService("service", p.Config.Port)
	v.PresetID = p.ID
	v.PortOverride = port
	v.SNIOverride = sni
	d := saveEngine(t, s, id, proxy.Draft{Services: []proxy.Service{v}})
	task := actionEngine(t, s, id, "initial-"+id, "engine.apply", d.Version)
	replyEngine(t, s, task, "running")
	return task
}
func editPreset(t *testing.T, s *Store, id string, change func(*proxy.PresetConfig)) proxy.PresetPreview {
	t.Helper()
	ctx := context.Background()
	p, err := s.ProtocolPreset(ctx, "admin", id)
	if err != nil {
		t.Fatal(err)
	}
	edit := proxy.PresetEdit{Config: p.Config, BaseDigest: p.Digest}
	change(&edit.Config)
	preview, err := s.PreviewProtocolPreset(ctx, "admin", id, edit)
	if err != nil {
		t.Fatal(err)
	}
	edit.Confirmation = preview.Confirmation
	if _, err = s.UpdateProtocolPreset(ctx, "admin", id, edit); err != nil {
		t.Fatal(err)
	}
	return preview
}
func engineAt(t *testing.T, s *Store, id string) proxy.Engine {
	t.Helper()
	e, err := s.Engine(context.Background(), "admin", id)
	if err != nil {
		t.Fatal(err)
	}
	return e
}
func countTasks(t *testing.T, s *Store) int {
	t.Helper()
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM tasks`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}
func claimSync(t *testing.T, s *Store) *v1.TaskDispatch {
	t.Helper()
	d, err := s.ClaimEngines(context.Background(), "node")
	if err != nil || d == nil {
		t.Fatalf("claim: %+v %v", d, err)
	}
	return d
}

func TestPresetSyncOfflineLatestAndOverrides(t *testing.T) {
	s := engineFixture(t)
	ctx := context.Background()
	p := syncPreset(t, s)
	original := publishPreset(t, s, p, "sing", nil, nil)
	port := 9443
	sni := "independent.example.com"
	publishPreset(t, s, p, "xray", &port, &sni)
	if err := s.Offline(ctx, "node"); err != nil {
		t.Fatal(err)
	}
	count := countTasks(t, s)
	editPreset(t, s, p.ID, func(c *proxy.PresetConfig) { c.Port = 10443; c.ServerName = "next.example.com" })
	editPreset(t, s, p.ID, func(c *proxy.PresetConfig) { c.Port = 11443 })
	if countTasks(t, s) != count {
		t.Fatal("offline edit created tasks")
	}
	if e := engineAt(t, s, "sing"); e.DesiredRevision != 3 || e.ObservedRevision != 1 || e.SyncState != "pending" {
		t.Fatalf("offline revisions: %+v", e)
	}
	if e := engineAt(t, s, "xray"); e.DesiredRevision != 1 {
		t.Fatal("overrides advanced version")
	}
	if d, err := s.ClaimEngines(ctx, "node"); err != nil || d != nil {
		t.Fatal("offline claim", d, err)
	}
	if err := s.Online(ctx, "node", v1.Hello{OS: "linux", Arch: "amd64", Capabilities: []string{v1.EngineCapability}}); err != nil {
		t.Fatal(err)
	}
	d := claimSync(t, s)
	if d.Engine.Revision != 3 || d.Engine.Services[0].ListenPort != 11443 || d.Engine.Services[0].ServerName != "next.example.com" {
		t.Fatal("did not coalesce latest", d.Engine)
	}
	if d.Engine.Services[0].PrivateKey != original.Engine.Services[0].PrivateKey || d.Engine.Services[0].Uuid != original.Engine.Services[0].Uuid {
		t.Fatal("sync rotated credentials")
	}
	replyEngine(t, s, d, "running")
	if e := engineAt(t, s, "sing"); e.ObservedRevision != 3 || e.SyncState != "synced" {
		t.Fatalf("not confirmed: %+v", e)
	}
	links, err := s.EngineConnections(ctx, "admin", "sing")
	if err != nil || len(links) != 1 || links[0].Revision != 3 {
		t.Fatal("connection not updated", links, err)
	}
	if d, err := s.ClaimEngines(ctx, "node"); err != nil || d != nil {
		t.Fatal("duplicate sync", d, err)
	}
}

func TestPresetSyncNoopDraftIsolationAndEqualOverride(t *testing.T) {
	s := engineFixture(t)
	p := syncPreset(t, s)
	port := p.Config.Port
	publishPreset(t, s, p, "sing", &port, nil)
	e := engineAt(t, s, "sing")
	e.Draft.Services = append(e.Draft.Services, sampleService("unpublished", 12443))
	saveEngine(t, s, "sing", e.Draft)
	preview := editPreset(t, s, p.ID, func(c *proxy.PresetConfig) { c.Name = "Rename"; c.Port = 10443 })
	if len(preview.Impacts) != 1 || preview.Impacts[0].Changed {
		t.Fatal("equal explicit override lost", preview)
	}
	if e := engineAt(t, s, "sing"); e.DesiredRevision != 1 {
		t.Fatal("metadata changed revision")
	}
	editPreset(t, s, p.ID, func(c *proxy.PresetConfig) { c.ShortIDs = []string{"ccdd", "aabb"} })
	d := claimSync(t, s)
	if len(d.Engine.Services) != 1 || d.Engine.Services[0].ShortIds[0] != "ccdd" {
		t.Fatal("draft leaked or short IDs not inherited", d.Engine)
	}
	replyEngine(t, s, d, "running")
	if e := engineAt(t, s, "sing"); len(e.Draft.Services) != 2 {
		t.Fatal("sync overwrote draft")
	}
}

func TestPresetSyncInFlightAndStoppedIntent(t *testing.T) {
	s := engineFixture(t)
	p := syncPreset(t, s)
	publishPreset(t, s, p, "sing", nil, nil)
	e := engineAt(t, s, "sing")
	stop := actionEngine(t, s, "sing", "stop", "engine.stop", e.Draft.Version)
	replyEngine(t, s, stop, "stopped")
	editPreset(t, s, p.ID, func(c *proxy.PresetConfig) { c.Port = 10443 })
	first := claimSync(t, s)
	if first.Engine.RunIntent != "stopped" {
		t.Fatal("lost stop intent")
	}
	editPreset(t, s, p.ID, func(c *proxy.PresetConfig) { c.Port = 11443 })
	if d, err := s.ClaimEngines(context.Background(), "node"); err != nil || d != nil {
		t.Fatal("parallel operation", d, err)
	}
	replyEngine(t, s, first, "stopped")
	e = engineAt(t, s, "sing")
	if e.ObservedRevision >= e.DesiredRevision {
		t.Fatal("old result confirmed latest")
	}
	latest := claimSync(t, s)
	if latest.Engine.Services[0].ListenPort != 11443 || latest.Engine.RunIntent != "stopped" {
		t.Fatal("wrong next target")
	}
	replyEngine(t, s, latest, "stopped")
}

func TestPresetConfirmationAndPermissions(t *testing.T) {
	s := engineFixture(t)
	ctx := context.Background()
	p := syncPreset(t, s)
	publishPreset(t, s, p, "sing", nil, nil)
	detail, err := s.ProtocolPreset(ctx, "admin", p.ID)
	if err != nil {
		t.Fatal(err)
	}
	edit := proxy.PresetEdit{Config: detail.Config, BaseDigest: detail.Digest}
	edit.Config.Port = 10443
	if _, err = s.PreviewProtocolPreset(ctx, "operator", p.ID, edit); !errors.Is(err, proxy.ErrForbidden) {
		t.Fatal("cross node preview", err)
	}
	preview, err := s.PreviewProtocolPreset(ctx, "admin", p.ID, edit)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.UpdateProtocolPreset(ctx, "admin", p.ID, edit); !errors.Is(err, proxy.ErrPresetStale) {
		t.Fatal("missing confirmation", err)
	}
	edit.Confirmation = preview.Confirmation
	e := engineAt(t, s, "sing")
	e.Draft.Services[0].Name = "Concurrent edit"
	saveEngine(t, s, "sing", e.Draft)
	if _, err = s.UpdateProtocolPreset(ctx, "admin", p.ID, edit); !errors.Is(err, proxy.ErrPresetStale) {
		t.Fatal("stale scope accepted", err)
	}
	preview, err = s.PreviewProtocolPreset(ctx, "admin", p.ID, edit)
	if err != nil {
		t.Fatal(err)
	}
	edit.Confirmation = preview.Confirmation
	edit.Config.Port = 11443
	if _, err = s.UpdateProtocolPreset(ctx, "admin", p.ID, edit); !errors.Is(err, proxy.ErrPresetStale) {
		t.Fatal("tampered confirmation", err)
	}
	if e := engineAt(t, s, "sing"); e.DesiredRevision != 1 {
		t.Fatal("rejected update changed target")
	}
}

func TestPresetSyncConflictAndFailureAreNotSuccess(t *testing.T) {
	s := engineFixture(t)
	ctx := context.Background()
	p := syncPreset(t, s)
	publishPreset(t, s, p, "sing", nil, nil)
	saveEngine(t, s, "xray", proxy.Draft{Services: []proxy.Service{sampleService("reserved", 10443)}})
	preview := editPreset(t, s, p.ID, func(c *proxy.PresetConfig) { c.Port = 10443 })
	if preview.Impacts[0].Issue == "" {
		t.Fatal("missing conflict warning")
	}
	if d, err := s.ClaimEngines(ctx, "node"); err != nil || d != nil {
		t.Fatal("conflicting target dispatched", d, err)
	}
	if e := engineAt(t, s, "sing"); e.SyncState != "failed" || e.ObservedRevision != 1 {
		t.Fatal("false success")
	}
	editPreset(t, s, p.ID, func(c *proxy.PresetConfig) { c.Port = 11443 })
	d := claimSync(t, s)
	reply := v1.TaskReply{TaskID: d.TaskID, ResourceID: d.ResourceID, Attempt: *d.Attempt, State: "failed", ErrorCode: "engine_invalid_config", Engine: &v1.EngineResult{Name: d.Engine.Name, Version: d.Engine.Version, Revision: d.Engine.Revision, Status: "running", ErrorCode: "engine_invalid_config", Diagnostic: &v1.EngineDiagnostic{Stage: "validate", Message: "规则 listen_port 无效"}}}
	if err := s.ReplyEngine(ctx, "node", "task.result", reply); err != nil {
		t.Fatal(err)
	}
	if e := engineAt(t, s, "sing"); e.ObservedRevision != 1 || e.SyncState != "failed" || e.SyncErrorMessage != "规则 listen_port 无效" {
		t.Fatal("failed result advanced observed")
	}
	if d, err := s.ClaimEngines(ctx, "node"); err != nil || d != nil {
		t.Fatal("unbounded failed retry", d, err)
	}
	if err := s.RetryEngineSync(ctx, "admin", "sing"); err != nil {
		t.Fatal(err)
	}
	if e := engineAt(t, s, "sing"); e.SyncErrorMessage != "" {
		t.Fatal("retry retained stale diagnosis")
	}
	retry := claimSync(t, s)
	if retry.Engine.Revision != d.Engine.Revision {
		t.Fatal("retry changed desired revision")
	}
}

func TestPresetSyncMultipleNodesAndRestart(t *testing.T) {
	s := engineFixture(t)
	ctx := context.Background()
	p := syncPreset(t, s)
	publishPreset(t, s, p, "sing", nil, nil)
	if _, err := s.db.Exec(`INSERT INTO engines(id,node_id,name,version,ownership,status) VALUES('remote','other','sing-box','1.14.4','managed','installed')`); err != nil {
		t.Fatal(err)
	}
	v := sampleService("remote-service", 8443)
	v.PresetID = p.ID
	draft := saveEngine(t, s, "remote", proxy.Draft{Services: []proxy.Service{v}})
	if _, err := s.EngineAction(ctx, "admin", "remote", proxy.Action{Operation: "engine.apply", DraftVersion: draft.Version, IdempotencyKey: "remote", Confirm: true}); err != nil {
		t.Fatal(err)
	}
	d, err := s.ClaimEngines(ctx, "other")
	if err != nil || d == nil {
		t.Fatal(d, err)
	}
	if err = s.ReplyEngine(ctx, "other", "task.result", v1.TaskReply{TaskID: d.TaskID, ResourceID: d.ResourceID, Attempt: *d.Attempt, State: "succeeded", Engine: &v1.EngineResult{Name: d.Engine.Name, Version: d.Engine.Version, Revision: d.Engine.Revision, Status: "running"}}); err != nil {
		t.Fatal(err)
	}
	if err = s.Offline(ctx, "other"); err != nil {
		t.Fatal(err)
	}
	preview := editPreset(t, s, p.ID, func(c *proxy.PresetConfig) { c.Port = 10443 })
	if len(preview.Impacts) != 2 {
		t.Fatal("missing node", preview)
	}
	replyEngine(t, s, claimSync(t, s), "running")
	if e := engineAt(t, s, "remote"); e.DesiredRevision != 2 || e.ObservedRevision != 1 {
		t.Fatal("offline target missing")
	}
	var path string
	if err = s.db.QueryRow(`SELECT file FROM pragma_database_list WHERE name='main'`).Scan(&path); err != nil {
		t.Fatal(err)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if err = reopened.Recover(ctx); err != nil {
		t.Fatal(err)
	}
	if err = reopened.Online(ctx, "other", v1.Hello{OS: "linux", Arch: "amd64", Capabilities: []string{v1.EngineCapability}}); err != nil {
		t.Fatal(err)
	}
	d, err = reopened.ClaimEngines(ctx, "other")
	if err != nil || d == nil || d.Engine.Revision != 2 || d.Engine.Services[0].ListenPort != 10443 {
		t.Fatal("lost target across restart", d, err)
	}
}

func TestPresetUpdateAtomicAndScopeRevocation(t *testing.T) {
	s := engineFixture(t)
	ctx := context.Background()
	p := syncPreset(t, s)
	publishPreset(t, s, p, "sing", nil, nil)
	if err := s.SetEngineGrant(ctx, "admin", "node", proxy.Grant{UserID: "operator", CanManage: true}); err != nil {
		t.Fatal(err)
	}
	detail, err := s.ProtocolPreset(ctx, "operator", p.ID)
	if err != nil {
		t.Fatal(err)
	}
	edit := proxy.PresetEdit{Config: detail.Config, BaseDigest: detail.Digest}
	edit.Config.Port = 10443
	preview, err := s.PreviewProtocolPreset(ctx, "operator", p.ID, edit)
	if err != nil {
		t.Fatal(err)
	}
	edit.Confirmation = preview.Confirmation
	if err = s.SetEngineGrant(ctx, "admin", "node", proxy.Grant{UserID: "operator"}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.UpdateProtocolPreset(ctx, "operator", p.ID, edit); !errors.Is(err, proxy.ErrForbidden) {
		t.Fatal("revoked scope accepted", err)
	}
	preview, err = s.PreviewProtocolPreset(ctx, "admin", p.ID, edit)
	if err != nil {
		t.Fatal(err)
	}
	edit.Confirmation = preview.Confirmation
	if _, err = s.db.Exec(`CREATE TRIGGER fail_target BEFORE UPDATE ON engine_targets BEGIN SELECT RAISE(ABORT,'test failure'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err = s.UpdateProtocolPreset(ctx, "admin", p.ID, edit); err == nil {
		t.Fatal("failed persistence returned success")
	}
	after, err := s.ProtocolPreset(ctx, "admin", p.ID)
	if err != nil || after.Digest != detail.Digest {
		t.Fatal("partial preset write", err)
	}
	if e := engineAt(t, s, "sing"); e.DesiredRevision != 1 {
		t.Fatal("partial target write")
	}
}

func TestPresetWhileStoppingRetainsStopAndReleasesOldPorts(t *testing.T) {
	s := engineFixture(t)
	p := syncPreset(t, s)
	publishPreset(t, s, p, "sing", nil, nil)
	e := engineAt(t, s, "sing")
	stop := actionEngine(t, s, "sing", "stop", "engine.stop", e.Draft.Version)
	preview := editPreset(t, s, p.ID, func(c *proxy.PresetConfig) { c.Port = 10443 })
	if preview.Impacts[0].RunIntent != "stopped" {
		t.Fatal("preview hid pending stop")
	}
	replyEngine(t, s, stop, "stopped")
	d := claimSync(t, s)
	if d.Engine.RunIntent != "stopped" {
		t.Fatal("sync restarted stopped engine")
	}
	replyEngine(t, s, d, "stopped")
	saveEngine(t, s, "xray", proxy.Draft{Services: []proxy.Service{sampleService("reuse", 8443)}})
}

func TestPresetSyncUnsupportedAndExpiredDoNotLoop(t *testing.T) {
	s := engineFixture(t)
	ctx := context.Background()
	p := syncPreset(t, s)
	publishPreset(t, s, p, "sing", nil, nil)
	editPreset(t, s, p.ID, func(c *proxy.PresetConfig) { c.Fingerprint = "firefox" })
	if err := s.RetryEngineSync(ctx, "admin", "sing"); err != nil {
		t.Fatal(err)
	}
	if d, err := s.ClaimEngines(ctx, "node"); err != nil || d != nil {
		t.Fatal("unsupported bypass through retry", d, err)
	}
	editPreset(t, s, p.ID, func(c *proxy.PresetConfig) { c.Fingerprint = "chrome"; c.Port = 10443 })
	d := claimSync(t, s)
	if _, err := s.db.Exec(`UPDATE tasks SET deadline_at='2000-01-01T00:00:00Z' WHERE id=?`, d.TaskID); err != nil {
		t.Fatal(err)
	}
	if err := s.Expire(ctx); err != nil {
		t.Fatal(err)
	}
	if next, err := s.ClaimEngines(ctx, "node"); err != nil || next != nil {
		t.Fatal("unknown outcome blindly retried", next, err)
	}
	if err := s.RetryEngineSync(ctx, "admin", "sing"); !errors.Is(err, proxy.ErrConflict) {
		t.Fatal("unknown result bypass", err)
	}
}

func TestPresetConcurrentEditsHaveSingleWinner(t *testing.T) {
	s := engineFixture(t)
	ctx := context.Background()
	p := syncPreset(t, s)
	publishPreset(t, s, p, "sing", nil, nil)
	detail, err := s.ProtocolPreset(ctx, "admin", p.ID)
	if err != nil {
		t.Fatal(err)
	}
	edits := []proxy.PresetEdit{}
	for _, port := range []int{10443, 11443} {
		edit := proxy.PresetEdit{Config: detail.Config, BaseDigest: detail.Digest}
		edit.Config.Port = port
		preview, err := s.PreviewProtocolPreset(ctx, "admin", p.ID, edit)
		if err != nil {
			t.Fatal(err)
		}
		edit.Confirmation = preview.Confirmation
		edits = append(edits, edit)
	}
	results := make(chan error, 2)
	for _, edit := range edits {
		go func(edit proxy.PresetEdit) {
			_, err := s.UpdateProtocolPreset(ctx, "admin", p.ID, edit)
			results <- err
		}(edit)
	}
	wins := 0
	for range edits {
		err := <-results
		if err == nil {
			wins++
		} else if !errors.Is(err, proxy.ErrPresetStale) {
			t.Fatal(err)
		}
	}
	if wins != 1 || engineAt(t, s, "sing").DesiredRevision != 2 {
		t.Fatal("concurrent edits both committed")
	}
}

func TestPresetSemanticCaseChangeDoesNotDeploy(t *testing.T) {
	s := engineFixture(t)
	p := syncPreset(t, s)
	publishPreset(t, s, p, "sing", nil, nil)
	preview := editPreset(t, s, p.ID, func(c *proxy.PresetConfig) {
		c.ServerName = "EXAMPLE.COM"
		c.Target = "EXAMPLE.COM:443"
		c.ShortIDs = []string{"AABB"}
	})
	if preview.Impacts[0].Changed || engineAt(t, s, "sing").DesiredRevision != 1 {
		t.Fatal("case-only edit changed effective config")
	}
}

func TestStopRemainsAvailableWithFailedPendingTarget(t *testing.T) {
	s := engineFixture(t)
	ctx := context.Background()
	p := syncPreset(t, s)
	publishPreset(t, s, p, "sing", nil, nil)
	editPreset(t, s, p.ID, func(c *proxy.PresetConfig) { c.Fingerprint = "firefox" })
	e := engineAt(t, s, "sing")
	stop := actionEngine(t, s, "sing", "stop-failed-target", "engine.stop", e.Draft.Version)
	replyEngine(t, s, stop, "stopped")
	editPreset(t, s, p.ID, func(c *proxy.PresetConfig) { c.Fingerprint = "chrome"; c.Port = 10443 })
	d := claimSync(t, s)
	if d.Engine.RunIntent != "stopped" {
		t.Fatal("new target lost stop intent")
	}
	replyEngine(t, s, d, "stopped")
	if d, err := s.ClaimEngines(ctx, "node"); err != nil || d != nil {
		t.Fatal("duplicate apply", d, err)
	}
}
