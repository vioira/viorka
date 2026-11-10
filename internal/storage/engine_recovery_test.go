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
	v1 "github.com/vioira/viorka/protocol/v1"
)

func TestDeletedNodeRecoversManagedEngines(t *testing.T) {
	s := engineFixture(t)
	ctx := context.Background()
	var snapshots []*v1.EngineRecovery
	for i, name := range []string{"sing", "realm"} {
		service := sampleService(name+"-service", 8443+i)
		if name == "realm" {
			service.ServerName = ""
		}
		draft := saveEngine(t, s, name, proxy.Draft{Services: []proxy.Service{service}})
		dispatch := actionEngine(t, s, name, "apply-"+name, "engine.apply", draft.Version)
		replyEngine(t, s, dispatch, "running")
		snapshots = append(snapshots, &v1.EngineRecovery{EngineID: name, Command: dispatch.Engine, Status: "running"})
	}
	before, err := s.EngineConnections(ctx, "admin", "sing")
	if err != nil || len(before) != 1 {
		t.Fatal("connection before", err)
	}
	if err = s.DeleteNode(ctx, "admin", "node"); err != nil {
		t.Fatal(err)
	}
	agents := auth.NewAgents(s, "https://panel.test")
	enrollment, err := agents.CreateEnrollment(ctx, "admin", "replacement", "vps")
	if err != nil {
		t.Fatal(err)
	}
	id, err := s.Enroll(ctx, auth.Hash(enrollment.Token), "new-key", snapshots...)
	if err != nil {
		t.Fatal(err)
	}
	if id != enrollment.ID {
		t.Fatal("wrong node")
	}
	for _, snapshot := range snapshots {
		engine, err := s.Engine(ctx, "admin", snapshot.EngineID)
		if err != nil {
			t.Fatal(err)
		}
		if engine.NodeID != id || engine.ObservedRevision != int64(snapshot.Command.Revision) || len(engine.Draft.Services) != 1 || engine.Status != "running" {
			t.Fatalf("recovery mismatch: %+v", engine)
		}
		// A retry must not erase edits made after recovery.
		engine.Draft.Services[0].Name = "edited"
		if _, err = s.SaveEngineDraft(ctx, "admin", engine.ID, engine.Draft); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = s.Enroll(ctx, auth.Hash(enrollment.Token), "new-key", snapshots...); err != nil {
		t.Fatal(err)
	}
	engine, err := s.Engine(ctx, "admin", "sing")
	if err != nil || engine.Draft.Services[0].Name != "edited" {
		t.Fatal("retry overwrote draft", err)
	}
	after, err := s.EngineConnections(ctx, "admin", "sing")
	if err != nil || len(after) != 1 || after[0].URL != before[0].URL {
		t.Fatal("connection changed", err)
	}
	if _, err = s.db.Exec(`UPDATE nodes SET state='online',os='linux',arch='amd64',engine_capable=1 WHERE id=?`, id); err != nil {
		t.Fatal(err)
	}
	task, err := s.EngineAction(ctx, "admin", "sing", proxy.Action{Operation: "engine.stop", DraftVersion: engine.Draft.Version, IdempotencyKey: "stop-recovered", Confirm: true})
	if err != nil {
		t.Fatal(err)
	}
	dispatch, err := s.ClaimEngines(ctx, id)
	if err != nil || dispatch == nil || dispatch.TaskID != task.ID || dispatch.ResourceID != "sing" || dispatch.Engine.Revision <= snapshots[0].Command.Revision {
		t.Fatal("cannot manage recovered engine", err)
	}
	reply := v1.TaskReply{TaskID: dispatch.TaskID, ResourceID: dispatch.ResourceID, Attempt: *dispatch.Attempt, State: "succeeded", Engine: &v1.EngineResult{Name: dispatch.Engine.Name, Version: dispatch.Engine.Version, Revision: dispatch.Engine.Revision, Status: "stopped"}}
	if err = s.Reply(ctx, id, "task.result", reply); err != nil {
		t.Fatal(err)
	}
	stopped, err := s.EngineConnections(ctx, "admin", "sing")
	if err != nil || len(stopped) != 1 || stopped[0].URL != before[0].URL {
		t.Fatal("stop lost recovered connection", err)
	}

}

func TestEngineRecoveryConflictRollsBackEnrollment(t *testing.T) {
	s := engineFixture(t)
	ctx := context.Background()
	a := auth.NewAgents(s, "https://panel.test")
	e, err := a.CreateEnrollment(ctx, "admin", "replacement", "vps")
	if err != nil {
		t.Fatal(err)
	}
	cmd := &v1.EngineCommand{Name: "realm", Version: v1.EngineVersion("realm"), Revision: 1, RunIntent: "stopped", Services: []*v1.EngineService{}}
	first := &v1.EngineRecovery{EngineID: "new-sing", Status: "stopped", Command: &v1.EngineCommand{Name: "sing-box", Version: v1.EngineVersion("sing-box"), Revision: 1, RunIntent: "stopped", Services: []*v1.EngineService{}}}
	_, err = s.Enroll(ctx, auth.Hash(e.Token), "key", first, &v1.EngineRecovery{EngineID: "realm", Command: cmd, Status: "stopped"})
	if !errors.Is(err, proxy.ErrConflict) {
		t.Fatal("ownership conflict accepted", err)
	}
	var count int
	if err = s.db.QueryRow(`SELECT count(*) FROM engines WHERE id='new-sing'`).Scan(&count); err != nil || count != 0 {
		t.Fatal("earlier engine not rolled back", err)
	}

	n, err := s.Node(ctx, e.ID)
	if err != nil || n.State != "pending" {
		t.Fatal("registration not rolled back", err)
	}
	if _, err = s.AgentKey(ctx, e.ID); !errors.Is(err, auth.ErrUnauthorized) {
		t.Fatal("credential leaked", err)
	}
	if _, err = s.Enroll(ctx, auth.Hash(e.Token), "key"); err != nil {
		t.Fatal("token consumed", err)
	}
}

func TestSameNodeReenrollmentPreservesEngineDraft(t *testing.T) {
	s := engineFixture(t)
	ctx := context.Background()
	d := saveEngine(t, s, "sing", proxy.Draft{Services: []proxy.Service{sampleService("service", 8443)}})
	if _, err := s.db.Exec(`UPDATE nodes SET state='offline' WHERE id='node'`); err != nil {
		t.Fatal(err)
	}
	a := auth.NewAgents(s, "https://panel.test")
	e, err := a.ResetEnrollment(ctx, "admin", "node")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Enroll(ctx, auth.Hash(e.Token), "replacement-key"); err != nil {
		t.Fatal(err)
	}
	engine, err := s.Engine(ctx, "admin", "sing")
	if err != nil || engine.NodeID != "node" || engine.Draft.Version != d.Version || len(engine.Draft.Services) != 1 {
		t.Fatal("reenrollment changed engine", err)
	}
}

func TestRecoverySecretsRemainEncrypted(t *testing.T) {
	s := engineFixture(t)
	ctx := context.Background()
	d := saveEngine(t, s, "sing", proxy.Draft{Services: []proxy.Service{sampleService("service", 8443)}})
	dispatch := actionEngine(t, s, "sing", "apply", "engine.apply", d.Version)
	replyEngine(t, s, dispatch, "running")
	snapshot := &v1.EngineRecovery{EngineID: "sing", Command: dispatch.Engine, Status: "running"}
	if err := s.DeleteNode(ctx, "admin", "node"); err != nil {
		t.Fatal(err)
	}
	snapshotPath := filepath.Join(t.TempDir(), "restored.db")
	if err := s.Backup(ctx, snapshotPath); err != nil {
		t.Fatal(err)
	}
	if err := ValidateSnapshot(ctx, snapshotPath); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(snapshotPath+".engine-key", s.engineKey, 0600); err != nil {
		t.Fatal(err)
	}
	restored, err := Open(ctx, snapshotPath)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	s = restored
	e, err := auth.NewAgents(s, "https://panel.test").CreateEnrollment(ctx, "admin", "new", "vps")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Enroll(ctx, auth.Hash(e.Token), "new-key", snapshot); err != nil {
		t.Fatal(err)
	}
	var encrypted, public string
	if err = s.db.QueryRow(`SELECT command_encrypted,public_snapshot FROM engine_targets WHERE engine_id='sing'`).Scan(&encrypted, &public); err != nil {
		t.Fatal(err)
	}
	secret := dispatch.Engine.Services[0].PrivateKey
	if strings.Contains(encrypted, secret) || strings.Contains(public, secret) {
		t.Fatal("plaintext secret")
	}
	raw, err := s.openEngine("sing", encrypted)
	if err != nil {
		t.Fatal(err)
	}
	var recovered v1.EngineCommand
	if err = json.Unmarshal(raw, &recovered); err != nil || recovered.Services[0].PrivateKey != secret {
		t.Fatal("secret not retained", err)
	}
}

func TestRecoveryRejectsConflictingServicePorts(t *testing.T) {
	s := engineFixture(t)
	ctx := context.Background()
	e, err := auth.NewAgents(s, "https://panel.test").CreateEnrollment(ctx, "admin", "new", "vps")
	if err != nil {
		t.Fatal(err)
	}
	command := func() *v1.EngineCommand {
		return &v1.EngineCommand{Name: "realm", Version: v1.EngineVersion("realm"), Revision: 1, RunIntent: "stopped", Services: []*v1.EngineService{{ID: "a", Name: "a", ListenHost: "0.0.0.0", ListenPort: 8443, TargetHost: "example.com", TargetPort: 443}}}
	}
	c := command()
	c.Services = append(c.Services, &v1.EngineService{ID: "b", Name: "b", ListenHost: "127.0.0.1", ListenPort: 8443, TargetHost: "example.net", TargetPort: 443})
	if _, err = s.Enroll(ctx, auth.Hash(e.Token), "key", &v1.EngineRecovery{EngineID: "new-realm", Command: c, Status: "stopped"}); !errors.Is(err, auth.ErrInvalid) {
		t.Fatal("conflicting config accepted", err)
	}
	var count int
	if err = s.db.QueryRow(`SELECT count(*) FROM engines WHERE node_id=?`, e.ID).Scan(&count); err != nil || count != 0 {
		t.Fatal("partial recovery", err)
	}
	if _, err = s.Enroll(ctx, auth.Hash(e.Token), "key"); err != nil {
		t.Fatal("token consumed", err)
	}
}

func TestRecoveryKeepsOutboundCredentialsIndependent(t *testing.T) {
	s := engineFixture(t)
	ctx := context.Background()
	e, err := auth.NewAgents(s, "https://panel.test").CreateEnrollment(ctx, "admin", "new", "vps")
	if err != nil {
		t.Fatal(err)
	}
	c := &v1.EngineCommand{Name: "sing-box", Version: v1.EngineVersion("sing-box"), Revision: 4, RunIntent: "stopped", Services: []*v1.EngineService{}, Outbounds: []*v1.EngineOutbound{{ID: "old-exit", Name: "exit", Type: "socks", Server: "example.net", ServerPort: 1080, Username: "user", Password: "retained-secret"}}, Routing: &v1.EngineRouting{OutboundIds: []string{"old-exit"}, Rules: []*v1.EngineRouteRule{}, Final: "old-exit"}}
	if _, err = s.Enroll(ctx, auth.Hash(e.Token), "key", &v1.EngineRecovery{EngineID: "recovered-sing", Command: c, Status: "stopped"}); err != nil {
		t.Fatal(err)
	}
	engine, err := s.Engine(ctx, "admin", "recovered-sing")
	if err != nil {
		t.Fatal(err)
	}
	if engine.Draft.Routing == nil || engine.Draft.Routing.Final == "old-exit" || len(engine.Draft.Routing.OutboundIds) != 1 || engine.Draft.Routing.OutboundIds[0] != engine.Draft.Routing.Final {
		t.Fatal("routing mapping lost")
	}
	outbound, err := s.readOutbound(ctx, s.db, engine.Draft.Routing.Final)
	if err != nil || outbound.Config.Password != "retained-secret" {
		t.Fatal("outbound credentials lost", err)
	}
	var next v1.EngineCommand
	if err = s.resolveOutbounds(ctx, s.db, engine.Draft, &next); err != nil || len(next.Outbounds) != 1 || next.Outbounds[0].Password != "retained-secret" {
		t.Fatal("cannot publish recovered routing", err)
	}
}
