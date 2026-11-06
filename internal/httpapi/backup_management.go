package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/settings"
)

func (a *api) registerBackupManagement(routes routeRegistry) {
	routes.handle("GET /api/v1/backups/policy", "getBackupPolicy", "admin", 200, nil, settings.BackupPolicy{}, a.user("admin", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		if a.Backups == nil {
			problem(w, auth.ErrNotFound)
			return
		}
		p, err := a.Backups.Policy(r.Context())
		if err != nil {
			problem(w, err)
			return
		}
		writeJSON(w, 200, p.Public())
	}))
	routes.handle("PUT /api/v1/backups/policy", "saveBackupPolicy", "admin", 200, settings.BackupPolicy{}, settings.BackupPolicy{}, a.user("admin", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		var p settings.BackupPolicy
		if !decode(w, r, &p) {
			return
		}
		if a.Backups == nil {
			problem(w, auth.ErrNotFound)
			return
		}
		p, err := a.Backups.SavePolicy(r.Context(), s.User.ID, p)
		if err != nil {
			problem(w, err)
			return
		}
		writeJSON(w, 200, p.Public())
	}))
	routes.handle("DELETE /api/v1/backups/{id}", "deleteBackup", "admin", 204, nil, nil, a.user("admin", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		if a.Backups == nil {
			problem(w, auth.ErrNotFound)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Minute)
		defer cancel()
		if err := a.Backups.Delete(ctx, s.User.ID, r.PathValue("id")); err != nil {
			problem(w, err)
			return
		}
		w.WriteHeader(204)
	}))
	routes.handle("GET /api/v1/backups/{id}/download", "downloadBackup", "admin", 200, nil, nil, a.user("admin", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		if a.Backups == nil {
			problem(w, auth.ErrNotFound)
			return
		}
		id := r.PathValue("id")
		f, err := a.Backups.Download(id)
		if err != nil {
			problem(w, err)
			return
		}
		defer f.Close()
		info, err := f.Stat()
		if err != nil {
			problem(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Disposition", `attachment; filename="`+id+`.backup"`)
		w.Header().Set("Cache-Control", "no-store")
		http.ServeContent(w, r, id+".backup", info.ModTime(), f)
	}))
}
