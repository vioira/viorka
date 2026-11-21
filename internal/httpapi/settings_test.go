package httpapi

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/settings"
	"github.com/vioira/viorka/internal/storage"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

func enableSettings(t *testing.T, f *fixture) {
	t.Helper()
	if e := f.store.InitSettings(context.Background(), f.server.URL); e != nil {
		t.Fatal(e)
	}
	backups, e := settings.NewBackups(filepath.Join(t.TempDir(), "panel.db"), f.store, storage.ValidateSnapshot)
	if e != nil {
		t.Fatal(e)
	}
	f.server.Config.Handler = NewRouter(Dependencies{Auth: f.users, Agents: f.agents, Nodes: f.store, Gateway: f.gate, Origin: f.server.URL, Shutdown: context.Background(), Settings: settings.New(f.store), Backups: backups})
}
func decodeResponse[T any](t *testing.T, res *http.Response, want int) T {
	t.Helper()
	defer res.Body.Close()
	if res.StatusCode != want {
		t.Fatalf("status %d want %d: %s", res.StatusCode, want, read(res))
	}
	var v T
	if e := json.NewDecoder(res.Body).Decode(&v); e != nil {
		t.Fatal(e)
	}
	return v
}
func expectStatus(t *testing.T, res *http.Response, want int) {
	t.Helper()
	if res.StatusCode != want {
		t.Fatalf("status %d want %d: %s", res.StatusCode, want, read(res))
	}
	res.Body.Close()
}
func TestSettingsPersistConflictAndPermissions(t *testing.T) {
	f := setup(t, "admin")
	enableSettings(t, f)
	value := decodeResponse[SettingsResponse](t, f.request("GET", "/api/v1/settings", nil, true), 200)
	if !value.Settings.SSE || value.Settings.Telemetry || value.Settings.HeartbeatTimeoutSeconds != 60 {
		t.Fatal(value)
	}
	for _, seconds := range []int{0, 59, 3601} {
		invalid := value.Settings
		invalid.HeartbeatTimeoutSeconds = seconds
		expectStatus(t, f.request("PUT", "/api/v1/settings", invalid, true), 400)
	}
	if value.Settings.OfflineAlertMinutes != 5 {
		t.Fatal(value.Settings)
	}
	for _, delay := range []int{-1, 1, 4, 11, 61} {
		invalid := value.Settings
		invalid.OfflineAlertMinutes = delay
		expectStatus(t, f.request("PUT", "/api/v1/settings", invalid, true), 400)
	}
	legacy := map[string]any{}
	raw, _ := json.Marshal(value.Settings)
	if err := json.Unmarshal(raw, &legacy); err != nil {
		t.Fatal(err)
	}
	legacy["theme"] = "dark"
	expectStatus(t, f.request("PUT", "/api/v1/settings", legacy, true), 400)
	value.Settings.PanelName = "My Panel"
	value.Settings.HeartbeatTimeoutSeconds = 600
	saved := decodeResponse[SettingsResponse](t, f.request("PUT", "/api/v1/settings", value.Settings, true), 200)
	if saved.Settings.Revision != 2 || saved.Settings.PanelName != "My Panel" || saved.Settings.HeartbeatTimeoutSeconds != 600 {
		t.Fatal(saved)
	}
	expectStatus(t, f.request("PUT", "/api/v1/settings", value.Settings, true), 409)
	saved.Settings.Telemetry = true
	expectStatus(t, f.request("PUT", "/api/v1/settings", saved.Settings, true), 400)
	saved.Settings.Telemetry = false
	saved.Settings.PublicOrigin = "https://example.com/path"
	expectStatus(t, f.request("PUT", "/api/v1/settings", saved.Settings, true), 400)
	expectStatus(t, f.request("GET", "/api/v1/settings", nil, false), 401)
	for _, role := range []string{"viewer", "operator"} {
		t.Run(role, func(t *testing.T) {
			f := setup(t, role)
			enableSettings(t, f)
			expectStatus(t, f.request("PUT", "/api/v1/settings", value.Settings, true), 403)
			expectStatus(t, f.request("POST", "/api/v1/backups", nil, true), 403)
			expectStatus(t, f.request("GET", "/api/v1/users", nil, true), 403)
		})
	}
}

// Both TLS addresses serve the same running handler and database.
func switchPublicOrigin(t *testing.T, old *fixture) *fixture {
	t.Helper()
	enableSettings(t, old)
	next := *old
	next.server = httptest.NewTLSServer(old.server.Config.Handler)
	t.Cleanup(next.server.Close)
	initial := decodeResponse[SettingsResponse](t, old.request("GET", "/api/v1/settings", nil, true), 200)
	change := initial.Settings
	change.PublicOrigin = next.server.URL
	saved := decodeResponse[SettingsResponse](t, old.request("PUT", "/api/v1/settings", change, true), 200)
	if saved.ActiveOrigin != next.server.URL || saved.Settings.PublicOrigin != saved.ActiveOrigin {
		t.Fatalf("saved origin mismatch: %+v", saved)
	}
	expectStatus(t, old.request("GET", "/api/v1/settings", nil, true), 403)
	return &next
}

func TestSavedOriginAppliesToNewAgent(t *testing.T) {
	f := switchPublicOrigin(t, setup(t, "admin"))
	current := decodeResponse[SettingsResponse](t, f.request("GET", "/api/v1/settings", nil, true), 200)
	if current.ActiveOrigin != f.server.URL {
		t.Fatal(current.ActiveOrigin)
	}
	stale := current.Settings
	stale.Revision--
	stale.PublicOrigin = "https://stale.example.com"
	expectStatus(t, f.request("PUT", "/api/v1/settings", stale, true), 409)
	insecure := current.Settings
	insecure.PublicOrigin = "http://localhost"
	expectStatus(t, f.request("PUT", "/api/v1/settings", insecure, true), 400)
	enrollment := decodeResponse[auth.Enrollment](t, f.request("POST", "/api/v1/nodes", EnrollmentRequest{Name: "origin-test", Kind: "nat"}, true), 201)
	pub, key, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	node := decodeResponse[EnrollResponse](t, f.request("POST", "/api/v1/agents/enroll", EnrollRequest{Token: enrollment.Token, PublicKey: base64.StdEncoding.EncodeToString(pub), ProtocolVersion: "1.0"}, false), 201)
	ch := decodeResponse[auth.Challenge](t, f.request("POST", "/api/v1/agents/challenge", ChallengeRequest{node.NodeID}, false), 200)
	expected := fmt.Sprintf("viorka-agent-session-v1\n%s\n%s\n%s\n%s", f.server.URL, node.NodeID, ch.ID, ch.ExpiresAt.Format(time.RFC3339Nano))
	if ch.Message != expected {
		t.Fatal("challenge is not bound to the new address")
	}
	req := AgentSessionRequest{ch.ID, base64.StdEncoding.EncodeToString(ed25519.Sign(key, []byte(expected)))}
	session := decodeResponse[auth.AgentSession](t, f.request("POST", "/api/v1/agents/session", req, false), 200)
	if len(session.Token) != 64 {
		t.Fatal("missing agent session")
	}
	expectStatus(t, f.request("POST", "/api/v1/agents/session", req, false), 401)
}
func TestPasswordChangeAndLogoutAll(t *testing.T) {
	f := setup(t, "admin")
	expectStatus(t, f.request("POST", "/api/v1/auth/password", PasswordRequest{"wrong", "new-password-123"}, true), 400)
	expectStatus(t, f.request("POST", "/api/v1/auth/password", PasswordRequest{"test-password-123", "short"}, true), 400)
	expectStatus(t, f.request("POST", "/api/v1/auth/password", PasswordRequest{"test-password-123", "new-password-123"}, true), 204)
	expectStatus(t, f.request("GET", "/api/v1/auth/session", nil, true), 200)
	expectStatus(t, f.request("POST", "/api/v1/auth/login", LoginRequest{"admin", "test-password-123"}, false), 401)
	expectStatus(t, f.request("POST", "/api/v1/auth/logout-all", nil, true), 204)
	expectStatus(t, f.request("GET", "/api/v1/auth/session", nil, true), 401)
	expectStatus(t, f.request("POST", "/api/v1/auth/login", LoginRequest{"admin", "new-password-123"}, false), 200)
}
func TestInvitationAcceptanceAndAdminProtection(t *testing.T) {
	f := setup(t, "admin")
	expectStatus(t, f.request("DELETE", "/api/v1/users/user", nil, true), 409)
	expectStatus(t, f.request("PUT", "/api/v1/users/user/role", RoleRequest{"viewer"}, true), 409)
	expectStatus(t, f.request("POST", "/api/v1/users/invitations", InviteRequest{"lin", "invalid", "viewer"}, true), 400)
	inv := decodeResponse[auth.Invitation](t, f.request("POST", "/api/v1/users/invitations", InviteRequest{"lin", "lin@example.com", "operator"}, true), 201)
	expectStatus(t, f.request("POST", "/api/v1/users/invitations", InviteRequest{"lin", "lin@example.com", "operator"}, true), 409)
	expectStatus(t, f.request("POST", "/api/v1/auth/accept-invitation", AcceptInvitationRequest{inv.Token, "lin-password-123"}, false), 204)
	expectStatus(t, f.request("POST", "/api/v1/auth/accept-invitation", AcceptInvitationRequest{inv.Token, "lin-password-123"}, false), 401)
	accounts := decodeResponse[AccountsResponse](t, f.request("GET", "/api/v1/users", nil, true), 200)
	if len(accounts.Items) != 2 {
		t.Fatal(accounts)
	}
	var id string
	for _, a := range accounts.Items {
		if a.Username == "lin" {
			id = a.ID
		}
	}
	expectStatus(t, f.request("POST", "/api/v1/auth/login", LoginRequest{"lin", "lin-password-123"}, false), 200)
	expectStatus(t, f.request("DELETE", "/api/v1/users/"+id, nil, true), 204)
	expectStatus(t, f.request("POST", "/api/v1/auth/login", LoginRequest{"lin", "lin-password-123"}, false), 401)
	expectStatus(t, f.request("GET", "/api/v1/users?limit=101", nil, true), 400)
}
func TestBackupCreationAndRestorePlanning(t *testing.T) {
	f := setup(t, "admin")
	enableSettings(t, f)
	backup := decodeResponse[settings.Backup](t, f.request("POST", "/api/v1/backups", nil, true), 201)
	list := decodeResponse[BackupResponse](t, f.request("GET", "/api/v1/backups", nil, true), 200)
	if len(list.Items) != 1 || list.Items[0].ID != backup.ID {
		t.Fatal(list)
	}
	expectStatus(t, f.request("POST", "/api/v1/backups/restore", RestoreRequest{backup.ID, "wrong"}, true), 400)
	result := decodeResponse[RestoreResponse](t, f.request("POST", "/api/v1/backups/restore", RestoreRequest{backup.ID, "test-password-123"}, true), 202)
	if result.State != "pending_restart" {
		t.Fatal(result)
	}
	expectStatus(t, f.request("DELETE", "/api/v1/backups/restore", nil, true), 204)
	list = decodeResponse[BackupResponse](t, f.request("GET", "/api/v1/backups", nil, true), 200)
	if list.PendingRestore != "" {
		t.Fatal(list)
	}
	expectStatus(t, f.request("POST", "/api/v1/backups/restore", RestoreRequest{"../../etc/passwd", "test-password-123"}, true), 400)
}

func TestSettingsCSRFAndNodeCreation(t *testing.T) {
	f := setup(t, "admin")
	enableSettings(t, f)
	v := decodeResponse[SettingsResponse](t, f.request("GET", "/api/v1/settings", nil, true), 200)
	csrf := f.session.CSRF
	f.session.CSRF = "wrong"
	expectStatus(t, f.request("PUT", "/api/v1/settings", v.Settings, true), 403)
	f.session.CSRF = csrf
	enrollment := decodeResponse[auth.Enrollment](t, f.request("POST", "/api/v1/nodes", EnrollmentRequest{Name: "node", Kind: "nat"}, true), 201)
	list := decodeResponse[NodesResponse](t, f.request("GET", "/api/v1/nodes", nil, true), 200)
	if len(list.Items) != 1 || list.Items[0].ID != enrollment.ID || list.Items[0].State != "pending" {
		t.Fatal(list)
	}
	expectStatus(t, f.request("DELETE", "/api/v1/nodes/"+enrollment.ID+"/enrollment-token", nil, true), 204)
	v.Settings.SSE = false
	decodeResponse[SettingsResponse](t, f.request("PUT", "/api/v1/settings", v.Settings, true), 200)
	expectStatus(t, f.request("GET", "/api/v1/events", nil, true), 409)
}
