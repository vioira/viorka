package httpapi

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"strings"
	"testing"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/proxy"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func TestRegistrationRestoresEngineSnapshot(t *testing.T) {
	f := setup(t, "admin")
	e := decodeResponse[auth.Enrollment](t, f.request("POST", "/api/v1/nodes", EnrollmentRequest{Name: "replacement", Kind: "vps"}, true), 201)
	key, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	snapshot := &v1.EngineRecovery{EngineID: "existing-realm", Status: "stopped", Command: &v1.EngineCommand{Name: "realm", Version: v1.EngineVersion("realm"), Revision: 9, RunIntent: "stopped", Services: []*v1.EngineService{{ID: "forward", Name: "forward", ListenHost: "127.0.0.1", ListenPort: 18443, TargetHost: "example.com", TargetPort: 443, Enabled: true}}}}
	request := auth.RegisterRequest{Token: e.Token, PublicKey: base64.StdEncoding.EncodeToString(key), ProtocolVersion: v1.Version, Engines: []*v1.EngineRecovery{snapshot}}
	batch := decodeResponse[auth.RegistrationSecret](t, f.request("POST", "/api/v1/node-registration-tokens", auth.RegistrationOptions{Name: "batch", Kind: "vps", MaxUses: 1, ExpiresInHours: 1}, true), 201)
	snapshot.Status = "unknown"
	expectStatus(t, f.request("POST", "/api/v1/agents/register", request, false), 400)
	snapshot.Status = "stopped"
	response := decodeResponse[EnrollResponse](t, f.request("POST", "/api/v1/agents/register", request, false), 201)
	if response.NodeID != e.ID {
		t.Fatal("wrong registration")
	}
	engine, err := f.store.Engine(context.Background(), f.session.User.ID, snapshot.EngineID)
	if err != nil || engine.NodeID != e.ID || engine.ObservedRevision != 9 || len(engine.Draft.Services) != 1 {
		t.Fatal("missing recovered engine", err)
	}
	// The token/key retry does not create a second engine or consume a new identity.
	expectStatus(t, f.request("POST", "/api/v1/agents/register", request, false), 201)

	// A batch enrollment cannot claim an engine still owned by the original node.
	var private ed25519.PrivateKey
	key, private, err = ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	request.PublicKey = base64.StdEncoding.EncodeToString(key)
	request.Token = batch.Token
	expectStatus(t, f.request("POST", "/api/v1/agents/register", request, false), 409)
	tokens, err := f.agents.RegistrationTokens(context.Background(), 10, "")
	if err != nil || len(tokens) != 1 || tokens[0].UsedCount != 0 {
		t.Fatal("conflict consumed quota", err)
	}
	records, err := f.agents.RegistrationRecords(context.Background(), batch.ID, 10, "")
	if err != nil || len(records) != 0 {
		t.Fatal("conflict left a registration", err)
	}

	snapshot.EngineID = "batch-realm"
	snapshot.EndpointBackup = &v1.EngineEndpointBackup{EngineID: snapshot.EngineID, Name: "realm", CommandSHA256: v1.EndpointCommandDigest(*snapshot.Command), Endpoints: []*v1.EnginePublicEndpoint{{ServiceID: "forward", Host: "entry.example.net", Port: 15443}}}
	registered := decodeResponse[EnrollResponse](t, f.request("POST", "/api/v1/agents/register", request, false), 201)
	snapshot.Command.Revision++
	retry := decodeResponse[EnrollResponse](t, f.request("POST", "/api/v1/agents/register", request, false), 201)
	if registered.NodeID == "" || registered.NodeID == e.ID || retry.NodeID != registered.NodeID {
		t.Fatal("wrong batch identity")
	}
	engine, err = f.store.Engine(context.Background(), f.session.User.ID, snapshot.EngineID)
	if err != nil || engine.NodeID != registered.NodeID || engine.ObservedRevision != 9 || len(engine.Draft.Services) != 1 {
		t.Fatal("incorrect batch recovery or retry overwrote engine", err)
	}
	tokens, err = f.agents.RegistrationTokens(context.Background(), 10, "")
	if err != nil || len(tokens) != 1 || tokens[0].UsedCount != 1 {
		t.Fatal("incorrect batch quota after retry", err)
	}

	conn := f.socket(registered.NodeID, f.token(registered.NodeID, private), v1.EngineCapability, v1.EngineEndpointsCapability)
	msg := receive(t, conn)
	var pushed v1.EngineEndpointBackup
	if msg.Type != "engine.endpoints" || msg.NodeID != registered.NodeID || v1.Decode(msg.Payload, &pushed) != nil || !pushed.Matches(snapshot.EngineID, *snapshot.Command) || len(pushed.Endpoints) != 1 || *pushed.Endpoints[0] != *snapshot.EndpointBackup.Endpoints[0] {
		t.Fatal("missing registered endpoint on negotiated WSS connection")
	}
}

func TestManagedRecoveryExplainsMissingCapabilities(t *testing.T) {
	f := setup(t, "admin")
	for _, tc := range []struct {
		capabilities []string
		message      string
	}{
		{nil, "管理连接未建立"},
		{[]string{}, "未提供引擎管理能力"},
		{[]string{v1.EngineCapability}, "未提供恢复能力"},
	} {
		node, key := f.enroll()
		if tc.capabilities != nil {
			f.socket(node, f.token(node, key), tc.capabilities...)
		}
		path := "/api/v1/nodes/" + node + "/engine-recovery"
		got := decodeResponse[ErrorResponse](t, f.request("POST", path, managedRecoveryRequest{Name: "realm", IdempotencyKey: "inspect"}, true), 409)
		if got.Code != "engine_recovery_unsupported" || !strings.Contains(got.Message, tc.message) {
			t.Fatalf("expected %q in recovery rejection, got %+v", tc.message, got)
		}
	}
}

func TestOnlineManagedEngineRecoveryOverWSS(t *testing.T) {
	f := setup(t, "admin")
	node, key := f.enroll()
	path := "/api/v1/nodes/" + node + "/engine-recovery"
	request := managedRecoveryRequest{Name: "realm", IdempotencyKey: "engine-recovery"}
	expectStatus(t, f.request("POST", path, request, false), 401)
	expectStatus(t, f.request("POST", path, request, true), 409)
	socket := f.socket(node, f.token(node, key), v1.EngineCapability, v1.EngineRecoveryCapability)
	task := decodeResponse[TaskResponse](t, f.request("POST", path, request, true), 202)
	confirmPath := path + "/" + task.ID
	expectStatus(t, f.request("POST", confirmPath, managedRecoveryConfirmation{Confirm: true}, true), 409)
	env := receive(t, socket)
	var d v1.TaskDispatch
	if env.Type != "task.dispatch" || v1.Decode(env.Payload, &d) != nil || d.Operation != v1.EngineRecoverOperation || d.TaskID != task.ID || d.ResourceID != node || d.Engine.Name != "realm" {
		t.Fatalf("incorrect recovery task: %+v", d)
	}
	snapshot := &v1.EngineRecovery{EngineID: "existing-realm", Status: "stopped", Unconfigured: true, Command: &v1.EngineCommand{Name: "realm", Version: v1.EngineVersion("realm"), Revision: 7, RunIntent: "running", Services: []*v1.EngineService{}}}
	reply := v1.Message("task.result", node, auth.Random(), v1.TaskReply{TaskID: d.TaskID, Attempt: *d.Attempt, ResourceID: node, State: "succeeded", Engine: &v1.EngineResult{Name: "realm", Version: snapshot.Command.Version, Status: snapshot.Status, Recovery: snapshot}})
	reply.CorrelationID = d.TaskID
	send(tWriter{t, socket}, reply)
	deadline := time.Now().Add(5 * time.Second)
	for {
		preview := decodeResponse[proxy.ManagedRecoveryPreview](t, f.request("GET", confirmPath, nil, true), 200)
		if preview.State == "succeeded" {
			if preview.EngineID != snapshot.EngineID || preview.Configured || preview.Revision != 7 || preview.Recovered {
				t.Fatalf("incorrect preview: %+v", preview)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("preview did not complete: %+v", preview)
		}
		time.Sleep(15 * time.Millisecond)
	}
	expectStatus(t, f.request("POST", confirmPath, managedRecoveryConfirmation{}, true), 400)
	for range 2 {
		confirmed := decodeResponse[managedRecoveryResponse](t, f.request("POST", confirmPath, managedRecoveryConfirmation{Confirm: true}, true), 200)
		if confirmed.EngineID != snapshot.EngineID {
			t.Fatal(confirmed)
		}
	}
	engine, err := f.store.Engine(context.Background(), f.session.User.ID, snapshot.EngineID)
	if err != nil || engine.Status != "installed" || engine.NodeID != node || engine.PublishedDraft != nil {
		t.Fatal(engine, err)
	}
}

func TestReinstalledNodeAutomaticallyVerifiesEnginesOverWSS(t *testing.T) {
	f := setup(t, "admin")
	enrollment := decodeResponse[auth.Enrollment](t, f.request("POST", "/api/v1/nodes", EnrollmentRequest{Name: "node A", Kind: "vps"}, true), 201)
	enroll := func(token string, snapshots []*v1.EngineRecovery) ed25519.PrivateKey {
		pub, key, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		node := decodeResponse[EnrollResponse](t, f.request("POST", "/api/v1/agents/enroll", EnrollRequest{Token: token, ProtocolVersion: v1.Version, PublicKey: base64.StdEncoding.EncodeToString(pub), Engines: snapshots}, false), 201)
		if node.NodeID != enrollment.ID {
			t.Fatal("node identity changed")
		}
		return key
	}
	var snapshots []*v1.EngineRecovery
	for _, name := range []string{"sing-box", "xray", "realm"} {
		snapshots = append(snapshots, &v1.EngineRecovery{EngineID: name, Status: "running", Command: &v1.EngineCommand{Name: name, Version: v1.EngineVersion(name), RunIntent: "running", Revision: 1, Services: []*v1.EngineService{}}})
	}
	enroll(enrollment.Token, snapshots)
	path := "/api/v1/nodes/" + enrollment.ID
	reset := decodeResponse[auth.Enrollment](t, f.request("POST", path+"/reenrollment", nil, true), 201)
	key := enroll(reset.Token, nil)
	conn := f.socketWithCapabilities(enrollment.ID, f.token(enrollment.ID, key), v1.EngineCapability)
	seen := map[string]bool{}
	for range snapshots {
		msg := receive(t, conn)
		var d v1.TaskDispatch
		if msg.Type != "task.dispatch" || v1.Decode(msg.Payload, &d) != nil || d.Operation != "engine.inspect" || !d.Engine.RecoveryCheck || seen[d.ResourceID] {
			t.Fatalf("unexpected dispatch: %+v", d)
		}
		seen[d.ResourceID] = true
		rev := uint64(0)
		reply := v1.Message("task.result", enrollment.ID, auth.Random(), v1.TaskReply{TaskID: d.TaskID, Attempt: *d.Attempt, ResourceID: d.ResourceID, State: "succeeded", Engine: &v1.EngineResult{Name: d.Engine.Name, Version: d.Engine.Version, Revision: d.Engine.Revision, Status: "not_installed", RecoveryRevision: &rev}})
		reply.CorrelationID = d.TaskID
		send(tWriter{t, conn}, reply)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		items := decodeResponse[EnginesResponse](t, f.request("GET", path+"/engines", nil, true), 200)
		verified := 0
		for _, e := range items.Items {
			if e.Status == "not_installed" && e.ReenrollmentCheck == "" && e.Version == "" && e.PublishedRevision == 0 {
				verified++
			}
		}
		if verified == 3 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("incomplete verification", items)
		}
		time.Sleep(10 * time.Millisecond)
	}
	expectStatus(t, f.request("POST", path+"/engines", InstallEngineRequest{Name: "sing-box", IdempotencyKey: "fresh-install", Confirm: true}, true), 202)
}
