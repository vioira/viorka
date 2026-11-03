package storage

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/vioira/viorka/internal/proxy"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func engineFixture(t *testing.T) *Store {
	t.Helper()
	s, err := Open(context.Background(), filepath.Join(t.TempDir(), "db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	_, err = s.db.Exec(`INSERT INTO users(id,username,password_hash,role,created_at) VALUES('admin','admin','hash','admin','now'),('operator','operator','hash','operator','now'),('viewer','viewer','hash','viewer','now');
 INSERT INTO nodes(id,name,kind,state,os,arch,engine_capable,created_at) VALUES('node','node','vps','online','linux','amd64',1,'now'),('other','other','nat','online','linux','amd64',1,'now');
 INSERT INTO engines(id,node_id,name,version,ownership,status) VALUES('sing','node','sing-box','1.14.4','managed','installed'),('xray','node','xray','26.10.31','managed','installed'),('realm','node','realm','2.9.6','managed','installed');`)
	if err != nil {
		t.Fatal(err)
	}
	return s
}
func sampleService(id string, port int) proxy.Service {
	return proxy.Service{ID: id, Name: id, Enabled: true, ListenHost: "0.0.0.0", ListenPort: port, TargetHost: "example.com", TargetPort: 443, ServerName: "example.com", PublicHost: "example.net", PublicPort: 443}
}
func saveEngine(t *testing.T, s *Store, id string, d proxy.Draft) proxy.Draft {
	t.Helper()
	d, err := s.SaveEngineDraft(context.Background(), "admin", id, d)
	if err != nil {
		t.Fatal(err)
	}
	return d
}
func actionEngine(t *testing.T, s *Store, id, key, op string, version int64) *v1.TaskDispatch {
	t.Helper()
	ctx := context.Background()
	task, err := s.EngineAction(ctx, "admin", id, proxy.Action{Operation: op, DraftVersion: version, IdempotencyKey: key, Confirm: true})
	if err != nil {
		t.Fatal(err)
	}
	d, err := s.ClaimEngines(ctx, "node")
	if err != nil || d == nil || d.TaskID != task.ID {
		t.Fatalf("dispatch: %+v %v", d, err)
	}
	return d
}
func replyEngine(t *testing.T, s *Store, d *v1.TaskDispatch, status string) {
	t.Helper()
	r := v1.TaskReply{TaskID: d.TaskID, ResourceID: d.ResourceID, Attempt: *d.Attempt, State: "succeeded", Engine: &v1.EngineResult{Name: d.Engine.Name, Version: d.Engine.Version, Revision: d.Engine.Revision, Status: status}}
	if err := s.Reply(context.Background(), "node", "task.result", r); err != nil {
		t.Fatal(err)
	}
}
func TestEngineDraftCASAndSharedPortReservations(t *testing.T) {
	s := engineFixture(t)
	ctx := context.Background()
	d := proxy.Draft{Services: []proxy.Service{sampleService("first", 8443)}}
	saved := saveEngine(t, s, "sing", d)
	if _, err := s.SaveEngineDraft(ctx, "admin", "sing", d); !errors.Is(err, proxy.ErrConflict) {
		t.Fatalf("stale accepted %v", err)
	}
	other := d
	other.Services = []proxy.Service{sampleService("other", 8443)}
	other.Services[0].ListenHost = "127.0.0.1"
	if _, err := s.SaveEngineDraft(ctx, "admin", "xray", other); !errors.Is(err, proxy.ErrConflict) {
		t.Fatalf("wildcard conflict %v", err)
	}
	saved.Services[0].Enabled = false
	saveEngine(t, s, "sing", saved)
	if _, err := s.SaveEngineDraft(ctx, "admin", "xray", other); !errors.Is(err, proxy.ErrConflict) {
		t.Fatalf("disabled released port %v", err)
	}
	d = proxy.Draft{Services: []proxy.Service{sampleService("v6", 9443)}}
	d.Services[0].ListenHost = "::"
	saveEngine(t, s, "xray", d)
	var wins int
	var mu sync.Mutex
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := s.SaveEngineDraft(ctx, "admin", "xray", proxy.Draft{Version: 1, Services: d.Services})
			if err == nil {
				mu.Lock()
				wins++
				mu.Unlock()
			} else if !errors.Is(err, proxy.ErrConflict) {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if wins != 1 {
		t.Fatalf("CAS winners %d", wins)
	}
}
func TestEngineAuthorizationAndAtomicSubmission(t *testing.T) {
	s := engineFixture(t)
	ctx := context.Background()
	if _, err := s.Engines(ctx, "operator", "node"); !errors.Is(err, proxy.ErrForbidden) {
		t.Fatal(err)
	}
	if err := s.SetEngineGrant(ctx, "admin", "node", proxy.Grant{UserID: "operator", CanManage: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Engines(ctx, "operator", "other"); !errors.Is(err, proxy.ErrForbidden) {
		t.Fatal("cross node access")
	}
	if _, err := s.InstallEngine(ctx, "operator", "node", "realm", proxy.Action{Operation: "engine.install", IdempotencyKey: "no-install", Confirm: true}); !errors.Is(err, proxy.ErrForbidden) {
		t.Fatal("operator installed", err)
	}
	d := saveEngine(t, s, "sing", proxy.Draft{Services: []proxy.Service{sampleService("service", 8443)}})
	a := proxy.Action{Operation: "engine.apply", DraftVersion: d.Version, IdempotencyKey: "apply", Confirm: true}
	first, err := s.EngineAction(ctx, "operator", "sing", a)
	if err != nil {
		t.Fatal(err)
	}
	again, err := s.EngineAction(ctx, "operator", "sing", a)
	if err != nil || again.ID != first.ID {
		t.Fatal("idempotency", err)
	}
	a.AllowUnreachable = true
	if _, err = s.EngineAction(ctx, "operator", "sing", a); !errors.Is(err, proxy.ErrConflict) {
		t.Fatal("changed intent", err)
	}
	a.IdempotencyKey = "second"
	if _, err = s.EngineAction(ctx, "operator", "sing", a); !errors.Is(err, proxy.ErrConflict) {
		t.Fatal("mutex", err)
	}
	var count int
	s.db.QueryRow(`SELECT count(*) FROM config_revisions`).Scan(&count)
	if count != 1 {
		t.Fatalf("partial revision %d", count)
	}
	var raw string
	s.db.QueryRow(`SELECT desired_json FROM config_revisions`).Scan(&raw)
	if strings.Contains(raw, "private_key") || json.Valid([]byte(raw)) {
		t.Fatal("plaintext desired")
	}
	dispatch, err := s.ClaimEngines(ctx, "node")
	if err != nil || dispatch.Engine == nil {
		t.Fatal(err)
	}
	if dispatch.Engine.Services[0].PrivateKey == "" {
		t.Fatal("missing generated credential")
	}
	task, err := s.Task(ctx, first.ID)
	if err != nil {
		t.Fatal(err)
	}
	public, _ := json.Marshal(task)
	if strings.Contains(string(public), dispatch.Engine.Services[0].PrivateKey) {
		t.Fatal("secret in task DTO")
	}
	bad := v1.TaskReply{TaskID: dispatch.TaskID, ResourceID: "xray", Attempt: *dispatch.Attempt, State: "accepted"}
	if err = s.ReplyEngine(ctx, "node", "task.ack", bad); err == nil {
		t.Fatal("wrong resource ack")
	}
	bad.ResourceID = "sing"
	bad.Attempt++
	if err = s.ReplyEngine(ctx, "node", "task.ack", bad); err == nil {
		t.Fatal("wrong attempt ack")
	}
	replyEngine(t, s, dispatch, "running")
	e, err := s.Engine(ctx, "admin", "sing")
	if err != nil || e.ObservedRevision != 1 {
		t.Fatal("not observed", err)
	}
	if _, err = s.EngineConnections(ctx, "operator", "sing"); !errors.Is(err, proxy.ErrForbidden) {
		t.Fatal("implicit export", err)
	}
	links, err := s.EngineConnections(ctx, "admin", "sing")
	if err != nil || len(links) != 1 || !strings.HasPrefix(links[0].URL, "vless://") {
		t.Fatal("links", err)
	}
}
func TestEngineApplicationRetainsLaterDraftAndDeletion(t *testing.T) {
	s := engineFixture(t)
	ctx := context.Background()
	d := saveEngine(t, s, "sing", proxy.Draft{Services: []proxy.Service{sampleService("service", 8443)}})
	dispatch := actionEngine(t, s, "sing", "apply1", "engine.apply", d.Version)
	d.Services = append(d.Services, sampleService("new", 9443))
	saved := saveEngine(t, s, "sing", d)
	replyEngine(t, s, dispatch, "running")
	e, _ := s.Engine(ctx, "admin", "sing")
	if e.Draft.Version != saved.Version || len(e.Draft.Services) != 2 {
		t.Fatal("later draft lost")
	}
	// A service in a successful snapshot must be marked, not removed immediately.
	if _, err := s.SaveEngineDraft(ctx, "admin", "sing", proxy.Draft{Version: saved.Version, Services: saved.Services[1:]}); !errors.Is(err, proxy.ErrConflict) {
		t.Fatal("deployed delete released early", err)
	}
	saved.Services[0].PendingDelete = true
	saved = saveEngine(t, s, "sing", saved)
	dispatch = actionEngine(t, s, "sing", "apply2", "engine.apply", saved.Version)
	if len(dispatch.Engine.Services) != 1 {
		t.Fatal("pending deletion still deployed")
	}
	replyEngine(t, s, dispatch, "running")
	e, _ = s.Engine(ctx, "admin", "sing")
	if len(e.Draft.Services) != 1 || e.Draft.Services[0].ID != "new" {
		t.Fatal("deletion not finalized")
	}
	saveEngine(t, s, "xray", proxy.Draft{Services: []proxy.Service{sampleService("reuse", 8443)}})
}
func TestEngineManualStopAndOffline(t *testing.T) {
	s := engineFixture(t)
	ctx := context.Background()
	d := saveEngine(t, s, "sing", proxy.Draft{Services: []proxy.Service{sampleService("service", 8443)}})
	stop := actionEngine(t, s, "sing", "stop", "engine.stop", d.Version)
	replyEngine(t, s, stop, "stopped")
	apply := actionEngine(t, s, "sing", "apply", "engine.apply", d.Version)
	if apply.Engine.RunIntent != "stopped" {
		t.Fatal("manual stop lost")
	}
	replyEngine(t, s, apply, "stopped")
	s.Offline(ctx, "node")
	e, _ := s.Engine(ctx, "admin", "sing")
	e.Draft.Services[0].Name = "offline edit"
	saveEngine(t, s, "sing", e.Draft)
	_, err := s.EngineAction(ctx, "admin", "sing", proxy.Action{Operation: "engine.start", IdempotencyKey: "offline", Confirm: true})
	if !errors.Is(err, proxy.ErrUnavailable) {
		t.Fatal("offline execution", err)
	}
}
func TestEngineCredentialRotationCannotBeUndoneByRestore(t *testing.T) {
	s := engineFixture(t)
	ctx := context.Background()
	d := saveEngine(t, s, "sing", proxy.Draft{Services: []proxy.Service{sampleService("service", 8443)}})
	first := actionEngine(t, s, "sing", "initial", "engine.apply", d.Version)
	old := first.Engine.Services[0].PrivateKey
	replyEngine(t, s, first, "running")
	e, _ := s.Engine(ctx, "admin", "sing")
	if _, err := s.EngineAction(ctx, "admin", "sing", proxy.Action{Operation: "engine.apply", DraftVersion: e.Draft.Version, IdempotencyKey: "rotate", RotateServiceID: "service", Confirm: true}); err != nil {
		t.Fatal(err)
	}
	rotation, err := s.ClaimEngines(ctx, "node")
	if err != nil || rotation == nil {
		t.Fatal(err)
	}
	current := rotation.Engine.Services[0].PrivateKey
	if current == old {
		t.Fatal("rotation reused key")
	}
	replyEngine(t, s, rotation, "running")
	e, _ = s.Engine(ctx, "admin", "sing")
	if _, err = s.EngineAction(ctx, "admin", "sing", proxy.Action{Operation: "engine.apply", DraftVersion: e.Draft.Version, IdempotencyKey: "restore", RestorePrevious: true, Confirm: true}); err != nil {
		t.Fatal(err)
	}
	restore, err := s.ClaimEngines(ctx, "node")
	if err != nil || restore == nil {
		t.Fatal(err)
	}
	if restore.Engine.Services[0].PrivateKey != current {
		t.Fatal("restore revived revoked key")
	}
}
func TestEngineCipherBindsResourceAndDetectsTampering(t *testing.T) {
	s := engineFixture(t)
	sealed, err := s.sealEngine("first", []byte("sensitive"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.openEngine("second", sealed); err == nil {
		t.Fatal("cross-resource decrypt")
	}
	if _, err = s.openEngine("first", sealed[:len(sealed)-4]+"AAAA"); err == nil {
		t.Fatal("tampered cipher")
	}
}
