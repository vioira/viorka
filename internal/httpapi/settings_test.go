package httpapi

import (
	"context"
	"encoding/json"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/settings"
	"github.com/vioira/viorka/internal/storage"
	"net/http"
	"path/filepath"
	"testing"
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
	if !value.Settings.SSE || value.Settings.Telemetry {
		t.Fatal(value)
	}
	value.Settings.PanelName = "My Panel"
	value.Settings.Theme = "light"
	saved := decodeResponse[SettingsResponse](t, f.request("PUT", "/api/v1/settings", value.Settings, true), 200)
	if saved.Settings.Revision != 2 || saved.Settings.PanelName != "My Panel" {
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

func TestSettingsCSRFAndEnrollmentList(t *testing.T) {
	f := setup(t, "admin")
	enableSettings(t, f)
	v := decodeResponse[SettingsResponse](t, f.request("GET", "/api/v1/settings", nil, true), 200)
	csrf := f.session.CSRF
	f.session.CSRF = "wrong"
	expectStatus(t, f.request("PUT", "/api/v1/settings", v.Settings, true), 403)
	f.session.CSRF = csrf
	enrollment := decodeResponse[auth.Enrollment](t, f.request("POST", "/api/v1/enrollment-tokens", EnrollmentRequest{Name: "node", Kind: "nat"}, true), 201)
	list := decodeResponse[EnrollmentListResponse](t, f.request("GET", "/api/v1/enrollment-tokens", nil, true), 200)
	if len(list.Items) != 1 || list.Items[0].ID != enrollment.ID || list.Items[0].State != "active" {
		t.Fatal(list)
	}
	expectStatus(t, f.request("DELETE", "/api/v1/enrollment-tokens/"+enrollment.ID, nil, true), 204)
	list = decodeResponse[EnrollmentListResponse](t, f.request("GET", "/api/v1/enrollment-tokens", nil, true), 200)
	if list.Items[0].State != "revoked" {
		t.Fatal(list)
	}
	v.Settings.SSE = false
	decodeResponse[SettingsResponse](t, f.request("PUT", "/api/v1/settings", v.Settings, true), 200)
	expectStatus(t, f.request("GET", "/api/v1/events", nil, true), 409)
}
