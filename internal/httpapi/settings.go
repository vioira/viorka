package httpapi

import (
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/settings"
	"net/http"
	"strconv"
	"strings"
	"time"
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
	NextCursor     string            `json:"next_cursor"`
}
type RestoreRequest struct {
	ID              string `json:"id"`
	CurrentPassword string `json:"current_password"`
}
type RestoreResponse struct {
	State string `json:"state"`
	ID    string `json:"id"`
}
type NotificationReadRequest struct {
	Read *bool `json:"read"`
}

type NotificationsReadRequest struct {
	IDs []string `json:"ids"`
}

type NotificationsResponse struct {
	Items []settings.Notification `json:"items"`
}

func (a *api) registerSettings(routes routeRegistry) {
	a.registerBackupManagement(routes)
	routes.handle("PUT /api/v1/notifications/read", "markNotificationsRead", "viewer", 204, NotificationsReadRequest{}, nil, a.user("viewer", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		if a.Settings == nil {
			problem(w, auth.ErrNotFound)
			return
		}
		var v NotificationsReadRequest
		if !decode(w, r, &v) {
			return
		}
		if err := a.Settings.MarkNotificationsRead(r.Context(), s.User.ID, v.IDs); err != nil {
			problem(w, err)
			return
		}
		w.WriteHeader(204)
	}))

	routes.handle("PUT /api/v1/notifications/{id}/read", "setNotificationRead", "viewer", 204, NotificationReadRequest{}, nil, a.user("viewer", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		if a.Settings == nil {
			problem(w, auth.ErrNotFound)
			return
		}
		var v NotificationReadRequest
		if !decode(w, r, &v) {
			return
		}
		if v.Read == nil {
			problem(w, auth.ErrInvalid)
			return
		}
		if err := a.Settings.SetNotificationRead(r.Context(), s.User.ID, r.PathValue("id"), *v.Read); err != nil {
			problem(w, err)
			return
		}
		w.WriteHeader(204)
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
		if !a.allowedOrigin(r) {
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
		policy, e := a.Backups.Policy(r.Context())
		if e != nil {
			problem(w, e)
			return
		}
		limit := 50
		for key, values := range r.URL.Query() {
			if (key != "limit" && key != "after") || len(values) != 1 {
				problem(w, auth.ErrInvalid)
				return
			}
		}
		if len(r.URL.Query().Get("after")) > 128 {
			problem(w, auth.ErrInvalid)
			return
		}
		if raw := r.URL.Query().Get("limit"); raw != "" {
			limit, e = strconv.Atoi(raw)
		}
		if e != nil || limit < 1 || limit > 100 {
			problem(w, auth.ErrInvalid)
			return
		}
		if after := r.URL.Query().Get("after"); after != "" {
			found := false
			for i, item := range items {
				if item.ID == after {
					items = items[i+1:]
					found = true
					break
				}
			}
			if !found {
				problem(w, auth.ErrInvalid)
				return
			}
		}
		next := ""
		if len(items) > limit {
			items = items[:limit]
			next = items[len(items)-1].ID
		}
		for i := range items {
			items[i].ExpiresAt = nil
			if policy.RetentionDays > 0 {
				expiry := items[i].CreatedAt.Add(time.Duration(policy.RetentionDays) * 24 * time.Hour)
				items[i].ExpiresAt = &expiry
			}
		}
		writeJSON(w, 200, BackupResponse{items, pending, policy.RetentionDays, next})
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
		items, e := a.Settings.Notifications(r.Context(), s.User.ID)
		if e != nil {
			problem(w, e)
			return
		}
		writeJSON(w, 200, NotificationsResponse{items})
	}))
}
