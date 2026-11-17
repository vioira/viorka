package httpapi

import (
	"context"
	"errors"
	"github.com/vioira/viorka/internal/auth"
	v1 "github.com/vioira/viorka/protocol/v1"
	"net/http"
	"testing"
)

func TestResetEnrollmentRevokesIdentityAndKeepsNode(t *testing.T) {
	f := setup(t, "admin")
	node, key := f.enroll()
	session := f.token(node, key)
	renewed := decodeResponse[auth.Enrollment](t, f.request("POST", "/api/v1/nodes/"+node+"/reenrollment", nil, true), 201)
	if renewed.ID != node {
		t.Fatal("node replaced")
	}
	if _, _, err := f.agents.Authenticate(context.Background(), session); !errors.Is(err, auth.ErrUnauthorized) {
		t.Fatal("old session accepted", err)
	}
	if _, err := f.agents.Challenge(context.Background(), node); !errors.Is(err, auth.ErrUnauthorized) {
		t.Fatal("old identity accepted", err)
	}
	n, err := f.store.Node(context.Background(), node)
	if err != nil || n.State != "pending" {
		t.Fatal(n, err)
	}
}
func TestResetEnrollmentAuthorization(t *testing.T) {
	for _, role := range []string{"viewer", "operator"} {
		f := setup(t, role)
		node, _ := f.enroll()
		expectStatus(t, f.request("POST", "/api/v1/nodes/"+node+"/reenrollment", nil, true), 403)
	}
	f := setup(t, "admin")
	expectStatus(t, f.request("POST", "/api/v1/nodes/missing/reenrollment", nil, false), 401)
	expectStatus(t, f.request("POST", "/api/v1/nodes/missing/reenrollment", nil, true), 404)
	node, _ := f.enroll()
	_, err := f.store.CreateTask(context.Background(), "user", node, "busy")
	if err != nil {
		t.Fatal(err)
	}
	expectStatus(t, f.request("POST", "/api/v1/nodes/"+node+"/reenrollment", nil, true), 409)
}

func TestResetEnrollmentRejectsOnlineNodeAndCSRF(t *testing.T) {
	f := setup(t, "admin")
	node, key := f.enroll()
	path := "/api/v1/nodes/" + node + "/reenrollment"
	req, _ := http.NewRequest("POST", f.server.URL+path, nil)
	req.AddCookie(f.cookie)
	response, err := f.server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	expectStatus(t, response, 403)
	if err = f.store.Online(context.Background(), node, v1.Hello{OS: "linux", Arch: "amd64"}); err != nil {
		t.Fatal(err)
	}
	expectStatus(t, f.request("POST", path, nil, true), 409)
	// Rejection must not revoke the previous identity.
	_ = f.token(node, key)
}
