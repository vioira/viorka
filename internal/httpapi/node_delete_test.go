package httpapi

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/inventory"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func TestDeleteNodeClosesSessionAndRejectsOldIdentity(t *testing.T) {
	f := setup(t, "admin")
	node, key := f.enroll()
	other, _ := f.enroll()
	token := f.token(node, key)
	ch, err := f.agents.Challenge(context.Background(), node)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "wss"+strings.TrimPrefix(f.server.URL, "https")+"/api/v1/agents/ws", &websocket.DialOptions{HTTPClient: f.server.Client(), HTTPHeader: http.Header{"Authorization": []string{"Bearer " + token}}})
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	send(tWriter{t, c}, v1.Message("system.hello", node, auth.Random(), v1.Hello{ProtocolVersions: []string{v1.Version}, OS: "linux", Arch: "amd64"}))
	receive(t, c)
	path := "/api/v1/nodes/" + node
	expectStatus(t, f.request("DELETE", path, nil, true), 204)
	if _, _, err = c.Read(ctx); err == nil {
		t.Fatal("deleted node retained its connection")
	}
	if _, _, err = f.agents.Authenticate(ctx, token); !errors.Is(err, auth.ErrUnauthorized) {
		t.Fatal("old session accepted", err)
	}
	if _, err = f.agents.Challenge(ctx, node); !errors.Is(err, auth.ErrUnauthorized) {
		t.Fatal("deleted identity issued a challenge", err)
	}
	signature := base64.StdEncoding.EncodeToString(ed25519.Sign(key, []byte(ch.Message)))
	if _, err = f.agents.Session(ctx, ch.ID, signature); !errors.Is(err, auth.ErrUnauthorized) {
		t.Fatal("outstanding challenge accepted", err)
	}
	for _, suffix := range []string{"", "/tasks", "/settings", "/metrics"} {
		expectStatus(t, f.request("GET", path+suffix, nil, true), 404)
	}
	expectStatus(t, f.request("DELETE", path, nil, true), 404)
	nodes := decodeResponse[NodesResponse](t, f.request("GET", "/api/v1/nodes", nil, true), 200)
	if len(nodes.Items) != 1 || nodes.Items[0].ID != other {
		t.Fatal("deletion did not isolate nodes", nodes)
	}
}

func TestDeletePendingAndDisabledNodes(t *testing.T) {
	for _, disabled := range []bool{false, true} {
		f := setup(t, "admin")
		e := decodeResponse[auth.Enrollment](t, f.request("POST", "/api/v1/nodes", EnrollmentRequest{Name: "pending", Kind: "nat"}, true), 201)
		if disabled {
			expectStatus(t, f.request("POST", "/api/v1/nodes/"+e.ID+"/revoke", nil, true), 204)
		}
		expectStatus(t, f.request("DELETE", "/api/v1/nodes/"+e.ID, nil, true), 204)
		expectStatus(t, f.request("POST", "/api/v1/agents/enroll", EnrollRequest{Token: e.Token, PublicKey: base64.StdEncoding.EncodeToString(make([]byte, 32)), ProtocolVersion: v1.Version}, false), 401)
	}
}

func TestDeleteNodeAuthorizationAndValidation(t *testing.T) {
	for _, role := range []string{"viewer", "operator"} {
		t.Run(role, func(t *testing.T) {
			f := setup(t, role)
			node, _ := f.enroll()
			expectStatus(t, f.request("DELETE", "/api/v1/nodes/"+node, nil, true), 403)
			if _, err := f.store.Node(context.Background(), node); err != nil {
				t.Fatal(err)
			}
		})
	}
	f := setup(t, "admin")
	node, _ := f.enroll()
	path := "/api/v1/nodes/" + node
	expectStatus(t, f.request("DELETE", path, nil, false), 401)
	for _, header := range []http.Header{{}, {"Origin": {f.server.URL}, "X-Csrf-Token": {"wrong"}}, {"Origin": {"https://other.test"}, "X-Csrf-Token": {f.session.CSRF}}} {
		r, _ := http.NewRequest("DELETE", f.server.URL+path, nil)
		r.Header = header
		r.AddCookie(f.cookie)
		res, err := f.server.Client().Do(r)
		if err != nil {
			t.Fatal(err)
		}
		expectStatus(t, res, 403)
	}
	expectStatus(t, f.request("DELETE", "/api/v1/nodes/"+strings.Repeat("x", 129), nil, true), 400)
	if _, err := f.store.Node(context.Background(), node); err != nil {
		t.Fatal("rejected requests changed node", err)
	}
	f.store.Close()
	expectStatus(t, f.request("DELETE", path, nil, true), 503)
}

func TestDeleteNodeActiveTaskConflict(t *testing.T) {
	f := setup(t, "admin")
	node, _ := f.enroll()
	if _, err := f.store.CreateTask(context.Background(), "user", node, "inspect"); err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/nodes/" + node
	response := decodeResponse[ErrorResponse](t, f.request("DELETE", path, nil, true), 409)
	if response.Code != "node_tasks_active" {
		t.Fatal(response)
	}
	decodeResponse[inventory.Node](t, f.request("GET", path, nil, true), 200)
}

func TestDeleteNodeContract(t *testing.T) {
	op := OpenAPIDocument().Paths["/api/v1/nodes/{id}"].Delete
	if op == nil || op.OperationID != "deleteNode" || len(op.Security) != 1 {
		t.Fatal("missing delete contract")
	}
	for _, code := range []string{"204", "400", "401", "403", "404", "409", "503"} {
		if op.Responses[code] == nil {
			t.Fatal("missing response", code)
		}
	}
}
