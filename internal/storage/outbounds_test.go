package storage

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/vioira/viorka/internal/proxy"

	"strings"
	"testing"
)

func createTestOutbound(t *testing.T, s *Store) proxy.Outbound {
	t.Helper()
	o, err := s.SaveOutbound(context.Background(), "admin", "", proxy.OutboundEdit{Config: proxy.OutboundConfig{Name: "Exit", Type: "socks", Server: "proxy.example.com", ServerPort: 1080, Username: "user", Password: "outbound-secret"}})
	if err != nil {
		t.Fatal(err)
	}
	return o
}
func outboundDraft(o proxy.Outbound) proxy.Draft {
	return proxy.Draft{Services: []proxy.Service{sampleService("service", 8443)}, Routing: &proxy.Routing{OutboundIds: []string{o.ID}, Final: o.ID, Sniff: true, Rules: []*proxy.RouteRule{}}}
}
func editTestOutbound(t *testing.T, s *Store, o proxy.Outbound, server string) proxy.Outbound {
	t.Helper()
	edit := proxy.OutboundEdit{Config: o.Config, Version: o.Version}
	edit.Config.Server = server
	p, err := s.PreviewOutbound(context.Background(), "admin", o.ID, edit)
	if err != nil {
		t.Fatal(err)
	}
	edit.Confirmation = p.Confirmation
	next, err := s.SaveOutbound(context.Background(), "admin", o.ID, edit)
	if err != nil {
		t.Fatal(err)
	}
	return next
}
func TestOutboundEncryptionAndReferenceValidation(t *testing.T) {
	s := engineFixture(t)
	ctx := context.Background()
	o := createTestOutbound(t, s)
	if o.Config.Password != "" || !o.HasPassword {
		t.Fatal("secret exposed")
	}
	var raw string
	if err := s.db.QueryRow(`SELECT config_encrypted FROM outbound_configs WHERE id=?`, o.ID).Scan(&raw); err != nil || strings.Contains(raw, "outbound-secret") {
		t.Fatal("plaintext storage", err)
	}
	d := saveEngine(t, s, "sing", outboundDraft(o))
	read := engineAt(t, s, "sing")
	if read.Draft.Routing.Final != o.ID {
		t.Fatal("routing not persisted")
	}
	items, err := s.Outbounds(ctx, "admin", "", 10)
	if err != nil || len(items) != 1 || items[0].References != 1 || items[0].Config.Password != "" {
		t.Fatal(items, err)
	}
	if err = s.DeleteOutbound(ctx, "admin", o.ID, o.Version); !errors.Is(err, proxy.ErrConflict) {
		t.Fatal("deleted referenced outbound", err)
	}
	d.Routing.OutboundIds = []string{"missing"}
	d.Routing.Final = "missing"
	if _, err = s.SaveEngineDraft(ctx, "admin", "sing", d); err == nil {
		t.Fatal("missing reference accepted")
	}
	d = outboundDraft(o)
	if _, err = s.SaveEngineDraft(ctx, "admin", "xray", d); !errors.Is(err, proxy.ErrInvalid) {
		t.Fatal("xray accepted routing", err)
	}
	if _, err = s.SaveOutbound(ctx, "viewer", "", proxy.OutboundEdit{Config: o.Config}); !errors.Is(err, proxy.ErrForbidden) {
		t.Fatal("viewer write", err)
	}
}
func TestOutboundSyncPreservesUnpublishedDraftAndCredentials(t *testing.T) {
	s := engineFixture(t)
	ctx := context.Background()
	o := createTestOutbound(t, s)
	d := saveEngine(t, s, "sing", outboundDraft(o))
	first := actionEngine(t, s, "sing", "publish-egress", "engine.apply", d.Version)
	if first.Engine.Routing.Final != o.ID || first.Engine.Outbounds[0].Password != "outbound-secret" {
		t.Fatal("resolved command missing outbound")
	}
	replyEngine(t, s, first, "running")
	d = engineAt(t, s, "sing").Draft
	d.Services[0].Name = "Unpublished"
	d.Routing.Final = "reject"
	d = saveEngine(t, s, "sing", d)
	if err := s.Offline(ctx, "node"); err != nil {
		t.Fatal(err)
	}
	tasks := countTasks(t, s)
	o = editTestOutbound(t, s, o, "new.example.com")
	o = editTestOutbound(t, s, o, "latest.example.com")
	if countTasks(t, s) != tasks {
		t.Fatal("offline update dispatched")
	}
	target, err := s.readTarget(ctx, s.db, "sing")
	if err != nil {
		t.Fatal(err)
	}
	if target.Draft.Routing.Final != o.ID || target.Draft.Services[0].Name == "Unpublished" || target.Command.Outbounds[0].Server != "latest.example.com" || target.Command.Outbounds[0].Password != "outbound-secret" {
		t.Fatal("snapshot or secret not preserved")
	}
	current := engineAt(t, s, "sing")
	if current.Draft.Routing.Final != "reject" || current.Draft.Version != d.Version {
		t.Fatal("draft overwritten")
	}
	if _, err = s.db.Exec(`UPDATE nodes SET state='online' WHERE id='node'`); err != nil {
		t.Fatal(err)
	}
	dispatch := claimSync(t, s)
	if dispatch.Engine.Routing.Final != o.ID {
		t.Fatal("unpublished routing deployed")
	}
	replyEngine(t, s, dispatch, "running")
	current = engineAt(t, s, "sing")
	if current.ObservedRevision != int64(dispatch.Engine.Revision) {
		t.Fatal("observed not confirmed")
	}
}
func TestOutboundPreviewStalePermissionAndAtomicFailure(t *testing.T) {
	s := engineFixture(t)
	ctx := context.Background()
	o := createTestOutbound(t, s)
	d := saveEngine(t, s, "sing", outboundDraft(o))
	replyEngine(t, s, actionEngine(t, s, "sing", "outbound-initial", "engine.apply", d.Version), "running")
	edit := proxy.OutboundEdit{Config: o.Config, Version: o.Version}
	edit.Config.Server = "changed.example.com"
	p, err := s.PreviewOutbound(ctx, "admin", o.ID, edit)
	if err != nil {
		t.Fatal(err)
	}
	edit.Confirmation = p.Confirmation
	d = engineAt(t, s, "sing").Draft
	d.Routing.Sniff = false
	saveEngine(t, s, "sing", d)
	if _, err = s.SaveOutbound(ctx, "admin", o.ID, edit); !errors.Is(err, proxy.ErrPresetStale) {
		t.Fatal("stale scope accepted", err)
	}
	if _, err = s.PreviewOutbound(ctx, "operator", o.ID, edit); !errors.Is(err, proxy.ErrForbidden) {
		t.Fatal("cross node accepted", err)
	}
	p, err = s.PreviewOutbound(ctx, "admin", o.ID, edit)
	if err != nil {
		t.Fatal(err)
	}
	edit.Confirmation = p.Confirmation
	if _, err = s.db.Exec(`CREATE TRIGGER fail_outbound_target BEFORE UPDATE ON engine_targets BEGIN SELECT RAISE(ABORT,'injected'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err = s.SaveOutbound(ctx, "admin", o.ID, edit); err == nil {
		t.Fatal("injected failure succeeded")
	}
	read, err := s.readOutbound(ctx, s.db, o.ID)
	if err != nil || read.Version != o.Version || read.Config.Server != o.Config.Server {
		t.Fatal("partial save", err)
	}
}
func TestOutboundRoutingSurvivesPresetUpdate(t *testing.T) {
	s := engineFixture(t)
	ctx := context.Background()
	p := syncPreset(t, s)
	o := createTestOutbound(t, s)
	d := outboundDraft(o)
	d.Services[0].PresetID = p.ID
	d = saveEngine(t, s, "sing", d)
	replyEngine(t, s, actionEngine(t, s, "sing", "both", "engine.apply", d.Version), "running")
	editPreset(t, s, p.ID, func(c *proxy.PresetConfig) { c.ShortIDs = []string{"ccdd"} })
	target, err := s.readTarget(ctx, s.db, "sing")
	if err != nil || target.Command.Outbounds[0].ID != o.ID || target.Draft.Routing.Final != o.ID {
		t.Fatal("preset update lost routing", err)
	}
	b, _ := json.Marshal(target.Draft)
	if strings.Contains(string(b), "outbound-secret") {
		t.Fatal("snapshot leaks credential")
	}
}

func TestOutboundUpdateKeepsCompletedStop(t *testing.T) {
	s := engineFixture(t)
	o := createTestOutbound(t, s)
	d := saveEngine(t, s, "sing", outboundDraft(o))
	replyEngine(t, s, actionEngine(t, s, "sing", "start-config", "engine.apply", d.Version), "running")
	stopped := actionEngine(t, s, "sing", "stop-egress", "engine.stop", engineAt(t, s, "sing").Draft.Version)
	replyEngine(t, s, stopped, "stopped")
	editTestOutbound(t, s, o, "new.example.com")
	target, err := s.readTarget(context.Background(), s.db, "sing")
	if err != nil || target.Command.RunIntent != "stopped" {
		t.Fatal("outbound edit restarted stopped engine", err)
	}
}

func TestOutboundRestoreResolvesCurrentSharedConfig(t *testing.T) {
	s := engineFixture(t)
	ctx := context.Background()
	o := createTestOutbound(t, s)
	d := saveEngine(t, s, "sing", outboundDraft(o))
	replyEngine(t, s, actionEngine(t, s, "sing", "first-config", "engine.apply", d.Version), "running")
	d = engineAt(t, s, "sing").Draft
	d.Routing.Final = "direct"
	d = saveEngine(t, s, "sing", d)
	replyEngine(t, s, actionEngine(t, s, "sing", "second-config", "engine.apply", d.Version), "running")
	o = editTestOutbound(t, s, o, "new.example.com")
	replyEngine(t, s, claimSync(t, s), "running")
	// The previous success was the same direct routing, but used older shared data.
	current := engineAt(t, s, "sing")
	_, err := s.EngineAction(ctx, "admin", "sing", proxy.Action{Operation: "engine.apply", DraftVersion: current.Draft.Version, IdempotencyKey: "restore-egress", Confirm: true, RestorePrevious: true})
	if err != nil {
		t.Fatal(err)
	}
	restored := claimSync(t, s)
	if restored.Engine.Outbounds[0].Server != "new.example.com" || restored.Engine.Outbounds[0].Password != "outbound-secret" {
		t.Fatal("restore resurrected old shared config")
	}
}

func TestOutboundDeletionWaitsForAppliedRemoval(t *testing.T) {
	s := engineFixture(t)
	ctx := context.Background()
	o := createTestOutbound(t, s)
	d := saveEngine(t, s, "sing", outboundDraft(o))
	replyEngine(t, s, actionEngine(t, s, "sing", "initial-exit", "engine.apply", d.Version), "running")
	d = engineAt(t, s, "sing").Draft
	d.Routing.OutboundIds = []string{}
	d.Routing.Final = "direct"
	d = saveEngine(t, s, "sing", d)
	removal := actionEngine(t, s, "sing", "remove-exit", "engine.apply", d.Version)
	if err := s.DeleteOutbound(ctx, "admin", o.ID, o.Version); !errors.Is(err, proxy.ErrConflict) {
		t.Fatal("deleted while previous configuration still active", err)
	}
	replyEngine(t, s, removal, "running")
	if err := s.DeleteOutbound(ctx, "admin", o.ID, o.Version); err != nil {
		t.Fatal(err)
	}
}

func TestOutboundConcurrentUpdateSingleWinner(t *testing.T) {
	s := engineFixture(t)
	ctx := context.Background()
	o := createTestOutbound(t, s)
	edit := proxy.OutboundEdit{Config: o.Config, Version: o.Version}
	edit.Config.Server = "next.example.com"
	preview, err := s.PreviewOutbound(ctx, "admin", o.ID, edit)
	if err != nil {
		t.Fatal(err)
	}
	edit.Confirmation = preview.Confirmation
	done := make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func() { _, err := s.SaveOutbound(ctx, "admin", o.ID, edit); done <- err }()
	}
	success, stale := 0, 0
	for i := 0; i < 2; i++ {
		err := <-done
		if err == nil {
			success++
		} else if errors.Is(err, proxy.ErrPresetStale) {
			stale++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || stale != 1 {
		t.Fatal(success, stale)
	}
}
