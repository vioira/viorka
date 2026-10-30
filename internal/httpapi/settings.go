package httpapi

import (
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/settings"
	"net/http"
	"strconv"
	"strings"
)

type SettingsRequest settings.Config
type SettingsResponse struct {
	Settings     SettingsRequest `json:"settings"`
	ActiveOrigin string          `json:"active_origin"`
}
type PasswordRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}
type AccountsResponse struct {
	Items []auth.Account `json:"items"`
}
type InviteRequest struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	Role     string `json:"role" enum:"admin,operator,viewer"`
}
type AcceptInvitationRequest struct {
	Token    string `json:"token"`
	Password string `json:"password"`
}
type RoleRequest struct {
	Role string `json:"role" enum:"admin,operator,viewer"`
}
type BackupResponse struct {
	Items          []settings.Backup `json:"items"`
	PendingRestore string            `json:"pending_restore"`
	RetentionDays  int               `json:"retention_days"`
}
type RestoreRequest struct {
	ID              string `json:"id"`
	CurrentPassword string `json:"current_password"`
}
type RestoreResponse struct {
	State string `json:"state"`
	ID    string `json:"id"`
}
type EnrollmentListResponse struct {
	Items []auth.EnrollmentRecord `json:"items"`
}
type NotificationsResponse struct {
	Items []settings.Notification `json:"items"`
}

func (a *api) registerSettings(routes routeRegistry) {
	routes.handle("GET /api/v1/enrollment-tokens", "listEnrollments", "admin", 200, nil, EnrollmentListResponse{}, a.user("admin", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		limit := 50
		var e error
		if raw := r.URL.Query().Get("limit"); raw != "" {
			limit, e = strconv.Atoi(raw)
		}
		after := r.URL.Query().Get("after")
		if e != nil || limit < 1 || limit > 100 || len(after) > 128 {
			problem(w, auth.ErrInvalid)
			return
		}
		items, e := a.Agents.Enrollments(r.Context(), limit, after)
		if e != nil {
			problem(w, e)
			return
		}
		writeJSON(w, 200, EnrollmentListResponse{items})
	}))

	routes.handle("GET /api/v1/settings", "getSettings", "viewer", 200, nil, SettingsResponse{}, a.user("viewer", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		if a.Settings == nil {
			problem(w, auth.ErrNotFound)
			return
		}
		v, e := a.Settings.Get(r.Context())
		if e != nil {
			problem(w, e)
			return
		}
		writeJSON(w, 200, SettingsResponse{SettingsRequest(v), a.Origin})
	}))
	routes.handle("PUT /api/v1/settings", "saveSettings", "admin", 200, SettingsRequest{}, SettingsResponse{}, a.user("admin", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		var v SettingsRequest
		if !decode(w, r, &v) {
			return
		}
		if a.Settings == nil {
			problem(w, auth.ErrNotFound)
			return
		}
		if strings.HasPrefix(a.Origin, "https://") && !strings.HasPrefix(v.PublicOrigin, "https://") {
			fail(w, 400, "origin_insecure", "公开 Origin 必须使用 HTTPS")
			return
		}
		if v.Telemetry {
			fail(w, 400, "telemetry_unconfigured", "尚未配置遥测接收地址，未发送任何数据")
			return
		}
		result, e := a.Settings.Save(r.Context(), s.User.ID, settings.Config(v))
		if e != nil {
			problem(w, e)
			return
		}
		writeJSON(w, 200, SettingsResponse{SettingsRequest(result), a.Origin})
	}))
	routes.handle("POST /api/v1/auth/password", "changePassword", "viewer", 204, PasswordRequest{}, nil, a.user("viewer", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		if !a.allow(w) {
			return
		}
		var v PasswordRequest
		if !decode(w, r, &v) {
			return
		}
		cookie, _ := r.Cookie("viorka_session")
		if e := a.Auth.ChangePassword(r.Context(), s, v.CurrentPassword, v.NewPassword, cookie.Value); e != nil {
			if e == auth.ErrUnauthorized {
				fail(w, 400, "password_incorrect", "当前密码不正确，请重新输入")
			} else {
				problem(w, e)
			}
			return
		}
		w.WriteHeader(204)
	}))
	routes.handle("POST /api/v1/auth/logout-all", "logoutAll", "viewer", 204, nil, nil, a.user("viewer", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		if e := a.Auth.LogoutAll(r.Context(), s.User.ID); e != nil {
			problem(w, e)
			return
		}
		a.cookie(w, "", -1)
		w.WriteHeader(204)
	}))
	routes.handle("GET /api/v1/users", "listUsers", "admin", 200, nil, AccountsResponse{}, a.user("admin", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		limit := 50
		var e error
		if raw := r.URL.Query().Get("limit"); raw != "" {
			limit, e = strconv.Atoi(raw)
		}
		after := r.URL.Query().Get("after")
		if e != nil || limit < 1 || limit > 100 || len(after) > 128 {
			problem(w, auth.ErrInvalid)
			return
		}
		items, e := a.Auth.Accounts(r.Context(), limit, after)
		if e != nil {
			problem(w, e)
			return
		}
		writeJSON(w, 200, AccountsResponse{items})
	}))
	routes.handle("POST /api/v1/users/invitations", "inviteUser", "admin", 201, InviteRequest{}, auth.Invitation{}, a.user("admin", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		var v InviteRequest
		if !decode(w, r, &v) {
			return
		}
		invite, e := a.Auth.Invite(r.Context(), s.User.ID, v.Username, v.Email, v.Role)
		if e != nil {
			problem(w, e)
			return
		}
		writeJSON(w, 201, invite)
	}))
	routes.handle("POST /api/v1/auth/accept-invitation", "acceptInvitation", "", 204, AcceptInvitationRequest{}, nil, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Origin") != a.Origin {
			fail(w, 403, "origin_rejected", "请求来源不受信任")
			return
		}
		if !a.allow(w) {
			return
		}
		var v AcceptInvitationRequest
		if !decode(w, r, &v) {
			return
		}
		if e := a.Auth.AcceptInvitation(r.Context(), v.Token, v.Password); e != nil {
			problem(w, e)
			return
		}
		w.WriteHeader(204)
	})
	routes.handle("DELETE /api/v1/users/{id}", "removeUser", "admin", 204, nil, nil, a.user("admin", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		if e := a.Auth.RemoveAccount(r.Context(), s.User.ID, r.PathValue("id")); e != nil {
			problem(w, e)
			return
		}
		w.WriteHeader(204)
	}))
	routes.handle("PUT /api/v1/users/{id}/role", "changeUserRole", "admin", 204, RoleRequest{}, nil, a.user("admin", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		var v RoleRequest
		if !decode(w, r, &v) {
			return
		}
		if e := a.Auth.ChangeRole(r.Context(), s.User.ID, r.PathValue("id"), v.Role); e != nil {
			problem(w, e)
			return
		}
		w.WriteHeader(204)
	}))
	routes.handle("GET /api/v1/backups", "listBackups", "admin", 200, nil, BackupResponse{}, a.user("admin", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		if a.Backups == nil {
			problem(w, auth.ErrNotFound)
			return
		}
		items, e := a.Backups.List()
		if e != nil {
			problem(w, e)
			return
		}
		pending, e := a.Backups.Pending()
		if e != nil {
			problem(w, e)
			return
		}
		writeJSON(w, 200, BackupResponse{items, pending, 14})
	}))
	routes.handle("POST /api/v1/backups", "createBackup", "admin", 201, nil, settings.Backup{}, a.user("admin", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		if a.Backups == nil {
			problem(w, auth.ErrNotFound)
			return
		}
		v, e := a.Backups.Create(r.Context(), s.User.ID)
		if e != nil {
			problem(w, e)
			return
		}
		writeJSON(w, 201, v)
	}))
	routes.handle("POST /api/v1/backups/restore", "restoreBackup", "admin", 202, RestoreRequest{}, RestoreResponse{}, a.user("admin", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		if !a.allow(w) {
			return
		}
		var v RestoreRequest
		if !decode(w, r, &v) {
			return
		}
		if a.Backups == nil {
			problem(w, auth.ErrNotFound)
			return
		}
		if _, e := a.Auth.VerifyPassword(r.Context(), s.User.Username, v.CurrentPassword); e != nil {
			fail(w, 400, "password_incorrect", "当前密码不正确，请重新输入")
			return
		}
		if e := a.Backups.PrepareRestore(r.Context(), s.User.ID, v.ID); e != nil {
			problem(w, e)
			return
		}
		writeJSON(w, 202, RestoreResponse{"pending_restart", v.ID})
	}))
	routes.handle("DELETE /api/v1/backups/restore", "cancelRestore", "admin", 204, nil, nil, a.user("admin", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		if a.Backups == nil {
			problem(w, auth.ErrNotFound)
			return
		}
		if e := a.Backups.CancelRestore(r.Context(), s.User.ID); e != nil {
			problem(w, e)
			return
		}
		w.WriteHeader(204)
	}))
	routes.handle("GET /api/v1/notifications", "listNotifications", "viewer", 200, nil, NotificationsResponse{}, a.user("viewer", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		if a.Settings == nil {
			problem(w, auth.ErrNotFound)
			return
		}
		items, e := a.Settings.Notifications(r.Context())
		if e != nil {
			problem(w, e)
			return
		}
		writeJSON(w, 200, NotificationsResponse{items})
	}))
}
