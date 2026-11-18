package httpapi

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"testing"

	"github.com/vioira/viorka/internal/auth"
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
	key, _, err = ed25519.GenerateKey(rand.Reader)
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
}
