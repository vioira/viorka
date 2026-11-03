package httpapi

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/inventory"
)

func TestEnrollmentNodeKinds(t *testing.T) {
	f := setup(t, "admin")
	for _, kind := range []string{"relay", "unknown", ""} {
		expectStatus(t, f.request("POST", "/api/v1/nodes", EnrollmentRequest{Name: "invalid", Kind: kind}, true), 400)
	}
	nodes := decodeResponse[NodesResponse](t, f.request("GET", "/api/v1/nodes", nil, true), 200)
	if len(nodes.Items) != 0 {
		t.Fatal("invalid node kind created a node")
	}
	for _, kind := range []string{"vps", "nat"} {
		e := decodeResponse[auth.Enrollment](t, f.request("POST", "/api/v1/nodes", EnrollmentRequest{Name: kind, Kind: kind}, true), 201)
		n := decodeResponse[inventory.Node](t, f.request("GET", "/api/v1/nodes/"+e.ID, nil, true), 200)
		if n.Kind != kind {
			t.Fatalf("kind = %q, want %q", n.Kind, kind)
		}
	}
}

func TestRenewEnrollmentPreservesNodeAndInvalidatesOldToken(t *testing.T) {
	f := setup(t, "admin")
	e := decodeResponse[auth.Enrollment](t, f.request("POST", "/api/v1/nodes", EnrollmentRequest{Name: "pending", Kind: "nat"}, true), 201)
	path := "/api/v1/nodes/" + e.ID + "/enrollment-token"
	renewed := decodeResponse[auth.Enrollment](t, f.request("POST", path, nil, true), 201)
	if renewed.ID != e.ID || renewed.Token == e.Token || !renewed.ExpiresAt.After(e.ExpiresAt) {
		t.Fatal("invalid renewal")
	}
	key := base64.StdEncoding.EncodeToString(make([]byte, 32))
	if _, err := f.agents.Enroll(context.Background(), e.Token, key, "1.0"); !errors.Is(err, auth.ErrUnauthorized) {
		t.Fatal("old token accepted", err)
	}
	id, err := f.agents.Enroll(context.Background(), renewed.Token, key, "1.0")
	if err != nil || id != e.ID {
		t.Fatal("renewed token failed", err)
	}
	expectStatus(t, f.request("POST", path, nil, true), 409)
	nodes := decodeResponse[NodesResponse](t, f.request("GET", "/api/v1/nodes", nil, true), 200)
	if len(nodes.Items) != 1 || nodes.Items[0].ID != e.ID {
		t.Fatal("renewal created another node")
	}
}

func TestRenewEnrollmentAuthorizationAndStates(t *testing.T) {
	for _, role := range []string{"viewer", "operator"} {
		f := setup(t, role)
		expectStatus(t, f.request("POST", "/api/v1/nodes/missing/enrollment-token", nil, true), 403)
	}
	f := setup(t, "admin")
	expectStatus(t, f.request("POST", "/api/v1/nodes/missing/enrollment-token", nil, false), 401)
	expectStatus(t, f.request("POST", "/api/v1/nodes/missing/enrollment-token", nil, true), 404)
	expectStatus(t, f.request("POST", "/api/v1/nodes/"+strings.Repeat("x", 129)+"/enrollment-token", nil, true), 400)
	e := decodeResponse[auth.Enrollment](t, f.request("POST", "/api/v1/nodes", EnrollmentRequest{Name: "pending", Kind: "nat"}, true), 201)
	path := "/api/v1/nodes/" + e.ID + "/enrollment-token"
	req, _ := http.NewRequest("POST", f.server.URL+path, nil)
	req.AddCookie(f.cookie)
	res, err := f.server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	expectStatus(t, res, 403)
	expectStatus(t, f.request("DELETE", path, nil, true), 204)
	decodeResponse[auth.Enrollment](t, f.request("POST", path, nil, true), 201)
	expectStatus(t, f.request("POST", "/api/v1/nodes/"+e.ID+"/revoke", nil, true), 204)
	expectStatus(t, f.request("POST", path, nil, true), 409)
}
