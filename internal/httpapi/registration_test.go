package httpapi

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"strings"
	"testing"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/inventory"
)

func TestRegistrationAPI(t *testing.T) {
	f := setup(t, "admin")
	path := "/api/v1/node-registration-tokens"
	options := auth.RegistrationOptions{Name: "batch", Kind: "nat", MaxUses: 1, ExpiresInHours: 24, NamePrefix: "hk-"}
	expectStatus(t, f.request("POST", path, options, false), 401)
	for _, o := range []auth.RegistrationOptions{{Name: "bad", Kind: "nat", MaxUses: 1}, {Name: "bad", Kind: "vps", MaxUses: 0, ExpiresInHours: 24}, {Name: "bad", Kind: "bad", MaxUses: 1, ExpiresInHours: 24}} {
		expectStatus(t, f.request("POST", path, o, true), 400)
	}
	token := decodeResponse[auth.RegistrationSecret](t, f.request("POST", path, options, true), 201)
	response := f.request("GET", path, nil, true)
	body := read(response)
	if response.StatusCode != 200 || strings.Contains(body, token.Token) || strings.Contains(body, "token_hash") {
		t.Fatal("list secret leakage", response.StatusCode)
	}
	key, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	request := auth.RegisterRequest{Token: token.Token, PublicKey: base64.StdEncoding.EncodeToString(key), ProtocolVersion: "1.0", Hostname: "host"}
	node := decodeResponse[EnrollResponse](t, f.request("POST", "/api/v1/agents/register", request, false), 201)
	retry := decodeResponse[EnrollResponse](t, f.request("POST", "/api/v1/agents/register", request, false), 201)
	if node.NodeID != retry.NodeID {
		t.Fatal("duplicate node")
	}
	n := decodeResponse[inventory.Node](t, f.request("GET", "/api/v1/nodes/"+node.NodeID, nil, true), 200)
	if n.Name != "hk-host" || n.State != "offline" {
		t.Fatal(n)
	}
	// Real challenge/session authenticates with the newly registered independent key.
	challenge := decodeResponse[auth.Challenge](t, f.request("POST", "/api/v1/agents/challenge", ChallengeRequest{NodeID: node.NodeID}, false), 200)
	session := decodeResponse[auth.AgentSession](t, f.request("POST", "/api/v1/agents/session", AgentSessionRequest{ChallengeID: challenge.ID, Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(private, []byte(challenge.Message)))}, false), 200)
	if session.Token == "" {
		t.Fatal("no authenticated session")
	}
	records := decodeResponse[RegistrationRecordsResponse](t, f.request("GET", path+"/"+token.ID+"/nodes", nil, true), 200)
	if len(records.Items) != 1 || records.Items[0].NodeID != node.NodeID {
		t.Fatal(records)
	}
	key, _, _ = ed25519.GenerateKey(rand.Reader)
	request.PublicKey = base64.StdEncoding.EncodeToString(key)
	expectStatus(t, f.request("POST", "/api/v1/agents/register", request, false), 409)
	expectStatus(t, f.request("GET", path+"?limit=101", nil, true), 400)
	expectStatus(t, f.request("GET", path+"/missing/nodes", nil, true), 404)
	expectStatus(t, f.request("DELETE", path+"/"+token.ID, nil, true), 204)
	expectStatus(t, f.request("POST", "/api/v1/agents/register", request, false), 401)
	expectStatus(t, f.request("PATCH", "/api/v1/nodes/"+node.NodeID, RenameNodeRequest{Name: "new", ExpectedName: "hk-host"}, true), 204)
	expectStatus(t, f.request("PATCH", "/api/v1/nodes/"+node.NodeID, RenameNodeRequest{Name: "other", ExpectedName: "hk-host"}, true), 409)
	expectStatus(t, f.request("PATCH", "/api/v1/nodes/"+node.NodeID, map[string]string{"name": "x", "expected_name": "new", "kind": "vps"}, true), 400)
	f.store.Close()
	expectStatus(t, f.request("GET", path, nil, true), 503)
}
func TestRegistrationAdminOnly(t *testing.T) {
	for _, role := range []string{"viewer", "operator"} {
		t.Run(role, func(t *testing.T) {
			f := setup(t, role)
			for _, v := range []struct{ method, path string }{{"GET", "/api/v1/node-registration-tokens"}, {"POST", "/api/v1/node-registration-tokens"}, {"DELETE", "/api/v1/node-registration-tokens/token"}, {"GET", "/api/v1/node-registration-tokens/token/nodes"}, {"PATCH", "/api/v1/nodes/node"}} {
				expectStatus(t, f.request(v.method, v.path, map[string]string{}, true), 403)
			}
		})
	}
}

func TestRegistrationSingleNodeToken(t *testing.T) {
	f := setup(t, "admin")
	enrollment := decodeResponse[auth.Enrollment](t, f.request("POST", "/api/v1/nodes", EnrollmentRequest{Name: "existing", Kind: "vps"}, true), 201)
	key, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	request := auth.RegisterRequest{Token: enrollment.Token, PublicKey: base64.StdEncoding.EncodeToString(key), ProtocolVersion: "1.0", Name: "ignored", Hostname: "host"}
	for i := 0; i < 2; i++ {
		node := decodeResponse[EnrollResponse](t, f.request("POST", "/api/v1/agents/register", request, false), 201)
		if node.NodeID != enrollment.ID {
			t.Fatal("single token created a different node")
		}
	}
	node := decodeResponse[inventory.Node](t, f.request("GET", "/api/v1/nodes/"+enrollment.ID, nil, true), 200)
	if node.Name != "existing" {
		t.Fatal("registration changed existing node name")
	}
	key, _, err = ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	request.PublicKey = base64.StdEncoding.EncodeToString(key)
	expectStatus(t, f.request("POST", "/api/v1/agents/register", request, false), 401)
	request.Token = strings.Repeat("0", 64)
	expectStatus(t, f.request("POST", "/api/v1/agents/register", request, false), 401)
}
