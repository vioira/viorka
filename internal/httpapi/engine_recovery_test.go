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

func TestEnrollmentRestoresEngineSnapshot(t *testing.T) {
	f := setup(t, "admin")
	e := decodeResponse[auth.Enrollment](t, f.request("POST", "/api/v1/nodes", EnrollmentRequest{Name: "replacement", Kind: "vps"}, true), 201)
	key, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	snapshot := &v1.EngineRecovery{EngineID: "existing-realm", Status: "stopped", Command: &v1.EngineCommand{Name: "realm", Version: v1.EngineVersion("realm"), Revision: 9, RunIntent: "stopped", Services: []*v1.EngineService{{ID: "forward", Name: "forward", ListenHost: "127.0.0.1", ListenPort: 18443, TargetHost: "example.com", TargetPort: 443, Enabled: true}}}}
	request := EnrollRequest{Token: e.Token, PublicKey: base64.StdEncoding.EncodeToString(key), ProtocolVersion: v1.Version, Engines: []*v1.EngineRecovery{snapshot}}
	snapshot.Status = "unknown"
	expectStatus(t, f.request("POST", "/api/v1/agents/enroll", request, false), 400)
	snapshot.Status = "stopped"
	response := decodeResponse[EnrollResponse](t, f.request("POST", "/api/v1/agents/enroll", request, false), 201)
	if response.NodeID != e.ID {
		t.Fatal("wrong registration")
	}
	engine, err := f.store.Engine(context.Background(), f.session.User.ID, snapshot.EngineID)
	if err != nil || engine.NodeID != e.ID || engine.ObservedRevision != 9 || len(engine.Draft.Services) != 1 {
		t.Fatal("missing recovered engine", err)
	}
	// The token/key retry does not create a second engine or consume a new identity.
	expectStatus(t, f.request("POST", "/api/v1/agents/enroll", request, false), 201)
}
