package httpapi

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/gateway"
	"github.com/vioira/viorka/internal/scheduler"
	"github.com/vioira/viorka/internal/storage"
	v1 "github.com/vioira/viorka/protocol/v1"
	"golang.org/x/crypto/bcrypt"
)

type fixture struct {
	t       *testing.T
	server  *httptest.Server
	store   *storage.Store
	users   *auth.Service
	agents  *auth.Agents
	gate    *gateway.Gateway
	session auth.Session
	cookie  *http.Cookie
}

func setup(t *testing.T, role string) *fixture {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	s, err := storage.Open(ctx, filepath.Join(t.TempDir(), "db"))
	if err != nil {
		t.Fatal(err)
	}
	h, err := bcrypt.GenerateFromPassword([]byte("test-password-123"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Bootstrap(ctx, auth.User{ID: "user", Username: "admin", PasswordHash: string(h), Role: role}); err != nil {
		t.Fatal(err)
	}
	users, err := auth.New(s)
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewUnstartedServer(nil)
	ts.StartTLS()
	agents := auth.NewAgents(s, ts.URL)
	gate := gateway.New(s, agents)
	ts.Config.Handler = NewRouter(Dependencies{History: s, Auth: users, Agents: agents, Nodes: s, Tasks: scheduler.New(s), Gateway: gate, Ready: s.Ping, Origin: ts.URL, Shutdown: ctx})
	f := &fixture{t: t, server: ts, store: s, users: users, agents: agents, gate: gate}
	t.Cleanup(func() { cancel(); gate.Close(); ts.Close(); s.Close() })
	res := f.request("POST", "/api/v1/auth/login", map[string]string{"username": "admin", "password": "test-password-123"}, false)
	if res.StatusCode != 200 {
		t.Fatalf("login: %s", read(res))
	}
	if err = json.NewDecoder(res.Body).Decode(&f.session); err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	f.cookie = res.Cookies()[0]
	return f
}
func read(r *http.Response) string {
	defer r.Body.Close()
	b, _ := io.ReadAll(r.Body)
	return string(b)
}
func (f *fixture) request(method, path string, body any, authenticated bool) *http.Response {
	f.t.Helper()
	b, _ := json.Marshal(body)
	r, _ := http.NewRequest(method, f.server.URL+path, bytes.NewReader(b))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Origin", f.server.URL)
	if authenticated {
		r.AddCookie(f.cookie)
		r.Header.Set("X-CSRF-Token", f.session.CSRF)
	}
	res, err := f.server.Client().Do(r)
	if err != nil {
		f.t.Fatal(err)
	}
	return res
}
func TestAuthenticationBoundaries(t *testing.T) {
	f := setup(t, "viewer")
	for _, tc := range []struct {
		method, path string
		body         any
		auth         bool
		status       int
	}{{"GET", "/healthz", nil, false, 200}, {"GET", "/readyz", nil, false, 200}, {"GET", "/api/v1/nodes", nil, false, 401}, {"GET", "/api/v1/nodes", nil, true, 200}, {"POST", "/api/v1/nodes", map[string]string{"name": "test", "kind": "nat"}, true, 403}, {"POST", "/api/v1/nodes/other/tasks", map[string]string{"operation": "node.inspect", "idempotency_key": "key"}, true, 403}, {"GET", "/api/v1/nodes?limit=101", nil, true, 400}} {
		res := f.request(tc.method, tc.path, tc.body, tc.auth)
		if res.StatusCode != tc.status {
			t.Errorf("%s got %d: %s", tc.path, res.StatusCode, read(res))
		}
		res.Body.Close()
	}
	if !f.cookie.HttpOnly || !f.cookie.Secure || f.cookie.SameSite != http.SameSiteStrictMode {
		t.Fatal("unsafe cookie")
	}
	r, _ := http.NewRequest("POST", f.server.URL+"/api/v1/auth/logout", nil)
	r.AddCookie(f.cookie)
	res, err := f.server.Client().Do(r)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != 403 {
		t.Fatal("missing CSRF accepted")
	}
	res.Body.Close()
	res = f.request("POST", "/api/v1/auth/logout", nil, true)
	if res.StatusCode != 204 {
		t.Fatal(read(res))
	}
	res.Body.Close()
	res = f.request("GET", "/api/v1/auth/session", nil, true)
	if res.StatusCode != 401 {
		t.Fatal("logout not persisted")
	}
	res.Body.Close()
}
func TestStrictRequestsAndStorageFailure(t *testing.T) {
	f := setup(t, "admin")
	res := f.request("POST", "/api/v1/nodes", map[string]string{"name": "test", "kind": "nat", "role": "admin"}, true)
	if res.StatusCode != 400 {
		t.Fatal(read(res))
	}
	res.Body.Close()
	f.store.Close()
	res = f.request("GET", "/readyz", nil, false)
	if res.StatusCode != 503 {
		t.Fatal(read(res))
	}
	res.Body.Close()
}
func (f *fixture) enroll() (string, ed25519.PrivateKey) {
	f.t.Helper()
	e, err := f.agents.CreateEnrollment(context.Background(), "user", "NAT test", "nat")
	if err != nil {
		f.t.Fatal(err)
	}
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	node, err := f.agents.Enroll(context.Background(), e.Token, base64.StdEncoding.EncodeToString(pub), v1.Version)
	if err != nil {
		f.t.Fatal(err)
	}
	if node != e.ID {
		f.t.Fatal("Agent did not bind the pre-created node", node, e.ID)
	}
	if again, err := f.agents.Enroll(context.Background(), e.Token, base64.StdEncoding.EncodeToString(pub)+"\n", v1.Version); err != nil || again != node {
		f.t.Fatal("lost enrollment response cannot be recovered", err)
	}
	return node, key
}
func (f *fixture) token(node string, key ed25519.PrivateKey) string {
	f.t.Helper()
	ctx := context.Background()
	ch, err := f.agents.Challenge(ctx, node)
	if err != nil {
		f.t.Fatal(err)
	}
	sig := base64.StdEncoding.EncodeToString(ed25519.Sign(key, []byte(ch.Message)))
	s, err := f.agents.Session(ctx, ch.ID, sig)
	if err != nil {
		f.t.Fatal(err)
	}
	if _, err = f.agents.Session(ctx, ch.ID, sig); err == nil {
		f.t.Fatal("challenge replay accepted")
	}
	return s.Token
}
func (f *fixture) socket(node, token string) *websocket.Conn {
	f.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "wss"+strings.TrimPrefix(f.server.URL, "https")+"/api/v1/agents/ws", &websocket.DialOptions{HTTPClient: f.server.Client(), HTTPHeader: http.Header{"Authorization": []string{"Bearer " + token}}})
	if err != nil {
		f.t.Fatal(err)
	}
	f.t.Cleanup(func() { c.CloseNow() })
	send(tWriter{f.t, c}, v1.Message("system.hello", node, auth.Random(), v1.Hello{AgentVersion: "test", ProtocolVersions: []string{"1.0"}, Capabilities: []string{"node.inspect"}, OS: "linux", Arch: "amd64"}))
	e := receive(f.t, c)
	var legacyAck struct {
		ProtocolVersion  string `json:"protocol_version"`
		HeartbeatSeconds uint64 `json:"heartbeat_seconds"`
	}
	if err := v1.Decode(e.Payload, &legacyAck); err != nil {
		f.t.Fatalf("legacy hello incompatible: %v", err)
	}
	if e.Type != "system.hello_ack" {
		f.t.Fatal(e.Type)
	}
	return c
}

type tWriter struct {
	t *testing.T
	c *websocket.Conn
}

func send(w tWriter, e v1.Envelope) {
	w.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	b, _ := json.Marshal(e)
	if err := w.c.Write(ctx, websocket.MessageText, b); err != nil {
		w.t.Fatal(err)
	}
}
func receive(t *testing.T, c *websocket.Conn) v1.Envelope {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, b, err := c.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var e v1.Envelope
	if err = json.Unmarshal(b, &e); err != nil {
		t.Fatal(err)
	}
	return e
}
func TestWSSDispatchReplayAndRevocation(t *testing.T) {
	f := setup(t, "admin")
	node, key := f.enroll()
	token := f.token(node, key)
	c := f.socket(node, token)
	svc := scheduler.New(f.store)
	task, err := svc.Create(context.Background(), "user", node, "node.inspect", "once")
	if err != nil {
		t.Fatal(err)
	}
	dup, err := svc.Create(context.Background(), "user", node, "node.inspect", "once")
	if err != nil || dup.ID != task.ID {
		t.Fatal("idempotency failed")
	}
	e := receive(t, c)
	var d v1.TaskDispatch
	if e.Type != "task.dispatch" || json.Unmarshal(e.Payload, &d) != nil {
		t.Fatal("no dispatch")
	}
	reply := v1.TaskReply{TaskID: d.TaskID, Attempt: *d.Attempt, ResourceID: node, State: "succeeded", Inspection: &v1.Inspection{OS: "linux", Arch: "amd64", Hostname: "test"}}
	msg := v1.Message("task.result", node, auth.Random(), reply)
	msg.CorrelationID = d.TaskID
	send(tWriter{t, c}, msg)
	send(tWriter{t, c}, msg)
	deadline := time.Now().Add(3 * time.Second)
	for {
		got, err := svc.Get(context.Background(), task.ID)
		if err != nil {
			t.Fatal(err)
		}
		if got.State == "succeeded" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("result not persisted")
		}
		time.Sleep(10 * time.Millisecond)
	}
	// An ack arriving after the result must not regress the terminal state.
	reply.State = "accepted"
	if err = f.store.Reply(context.Background(), node, "task.ack", reply); err != nil {
		t.Fatal(err)
	}
	got, _ := svc.Get(context.Background(), task.ID)
	if got.State != "succeeded" {
		t.Fatal("terminal regressed")
	}
	if err = f.agents.Revoke(context.Background(), "user", node); err != nil {
		t.Fatal(err)
	}
	f.gate.Revoke(node)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if _, _, err = c.Read(ctx); err == nil {
		t.Fatal("revoked connection alive")
	}
	if _, _, err = f.agents.Authenticate(ctx, token); err == nil {
		t.Fatal("revoked session accepted")
	}
}
func TestForgedNodeAndTLSMismatch(t *testing.T) {
	f := setup(t, "admin")
	node, key := f.enroll()
	c := f.socket(node, f.token(node, key))
	send(tWriter{t, c}, v1.Message("node.heartbeat", "different-node", auth.Random(), v1.Heartbeat{}))
	ctx, stop := context.WithTimeout(context.Background(), 3*time.Second)
	defer stop()
	if _, _, err := c.Read(ctx); err == nil {
		t.Fatal("forged node accepted")
	}
	untrusted := &http.Client{Timeout: time.Second}
	if res, err := untrusted.Get(f.server.URL + "/healthz"); err == nil {
		res.Body.Close()
		t.Fatal("untrusted TLS accepted")
	}
}
func TestSSERequiresSessionAndStopsOnLogout(t *testing.T) {
	f := setup(t, "admin")
	res := f.request("GET", "/api/v1/events", nil, false)
	if res.StatusCode != 401 {
		t.Fatal(read(res))
	}
	res.Body.Close()
	res = f.request("GET", "/api/v1/events", nil, true)
	defer res.Body.Close()
	buf := make([]byte, len("event: snapshot\ndata: {}\n\n"))
	if _, err := io.ReadFull(res.Body, buf); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(buf), "snapshot") {
		t.Fatal(string(buf))
	}
	if err := f.users.Logout(context.Background(), f.cookie.Value); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { _, err := io.Copy(io.Discard, res.Body); done <- err }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("SSE kept revoked session")
	}
}

func TestInvalidSignatureConsumesNonceAndRevokedEnrollment(t *testing.T) {
	f := setup(t, "admin")
	node, key := f.enroll()
	ctx := context.Background()
	ch, err := f.agents.Challenge(ctx, node)
	if err != nil {
		t.Fatal(err)
	}
	_, wrong, _ := ed25519.GenerateKey(rand.Reader)
	sig := base64.StdEncoding.EncodeToString(ed25519.Sign(wrong, []byte(ch.Message)))
	if _, err = f.agents.Session(ctx, ch.ID, sig); err == nil {
		t.Fatal("invalid signature accepted")
	}
	sig = base64.StdEncoding.EncodeToString(ed25519.Sign(key, []byte(ch.Message)))
	if _, err = f.agents.Session(ctx, ch.ID, sig); err == nil {
		t.Fatal("failed challenge replayed")
	}
	e, err := f.agents.CreateEnrollment(ctx, "user", "revoked", "nat")
	if err != nil {
		t.Fatal(err)
	}
	if err = f.agents.RevokeEnrollment(ctx, "user", e.ID); err != nil {
		t.Fatal(err)
	}
	pub, _, _ := ed25519.GenerateKey(rand.Reader)
	if _, err = f.agents.Enroll(ctx, e.Token, base64.StdEncoding.EncodeToString(pub), v1.Version); err == nil {
		t.Fatal("revoked enrollment accepted")
	}
}
func TestOversizedWSSMessageClosesConnection(t *testing.T) {
	f := setup(t, "admin")
	node, key := f.enroll()
	c := f.socket(node, f.token(node, key))
	ctx, stop := context.WithTimeout(context.Background(), 3*time.Second)
	defer stop()
	_ = c.Write(ctx, websocket.MessageText, []byte(strings.Repeat("x", 65537)))
	if _, _, err := c.Read(ctx); err == nil {
		t.Fatal("oversized frame accepted")
	}
}
