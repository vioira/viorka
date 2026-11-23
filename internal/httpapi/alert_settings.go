package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/vioira/viorka/internal/alerts"
	"github.com/vioira/viorka/internal/auth"
)

type alertRepository interface {
	AlertRuleStatus(context.Context, string, string) (alerts.StatusPage, error)
	AlertSettings(context.Context) (alerts.View, error)
	SaveAlertSettings(context.Context, string, alerts.Edit) error
	TestAlertChannel(context.Context, string, string) error
}
type AlertPreviewRequest struct {
	Template alerts.Template `json:"template"`
	Timezone string          `json:"timezone"`
}
type AlertPreview struct {
	Trigger  alerts.Message `json:"trigger"`
	Repeat   alerts.Message `json:"repeat"`
	Recovery alerts.Message `json:"recovery"`
}

func (a *api) registerAlertSettings(routes routeRegistry) {
	repo, _ := a.Nodes.(alertRepository)
	routes.handle("GET /api/v1/settings/notifications/rules/{id}/status", "getAlertRuleStatus", "admin", 200, nil, alerts.StatusPage{}, a.user("admin", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		if repo == nil {
			problem(w, auth.ErrNotFound)
			return
		}
		v, e := repo.AlertRuleStatus(r.Context(), r.PathValue("id"), r.URL.Query().Get("after"))
		if e != nil {
			problem(w, e)
			return
		}
		writeJSON(w, 200, v)
	}))
	routes.handle("GET /api/v1/settings/notifications", "getAlertSettings", "admin", 200, nil, alerts.View{}, a.user("admin", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		if repo == nil {
			problem(w, auth.ErrNotFound)
			return
		}
		v, e := repo.AlertSettings(r.Context())
		if e != nil {
			problem(w, e)
			return
		}
		writeJSON(w, 200, v)
	}))
	routes.handle("PUT /api/v1/settings/notifications", "saveAlertSettings", "admin", 200, alerts.Edit{}, alerts.View{}, a.user("admin", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		var edit alerts.Edit
		if !decodeLimit(w, r, &edit, 512<<10) {
			return
		}
		if repo == nil {
			problem(w, auth.ErrNotFound)
			return
		}
		if e := repo.SaveAlertSettings(r.Context(), s.User.ID, edit); e != nil {
			problem(w, e)
			return
		}
		v, e := repo.AlertSettings(r.Context())
		if e != nil {
			problem(w, e)
			return
		}
		writeJSON(w, 200, v)
	}))
	routes.handle("POST /api/v1/settings/notifications/channels/{id}/test", "testAlertChannel", "admin", 202, nil, nil, a.user("admin", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		if repo == nil {
			problem(w, auth.ErrNotFound)
			return
		}
		if e := repo.TestAlertChannel(r.Context(), r.PathValue("id"), s.User.ID); e != nil {
			problem(w, e)
			return
		}
		w.WriteHeader(202)
	}))
	routes.handle("POST /api/v1/settings/notifications/preview", "previewAlertTemplate", "admin", 200, AlertPreviewRequest{}, AlertPreview{}, a.user("admin", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		var p AlertPreviewRequest
		if !decode(w, r, &p) {
			return
		}
		zone, e := time.LoadLocation(p.Timezone)
		if e != nil || p.Timezone == "" || p.Timezone == "Local" || !p.Template.Valid() {
			problem(w, auth.ErrInvalid)
			return
		}
		rule := alerts.Rule{Name: "CPU 持续过高", Metric: "cpu", Mode: "average", Threshold: 85, WindowMinutes: 5}
		start := time.Now()
		render := func(state string, elapsed time.Duration, v float64) alerts.Message {
			return p.Template.Render(state, "示例节点", rule, v, start.Add(elapsed), start, zone)
		}
		if p.Template.ID == alerts.OfflineTemplate {
			rule = alerts.Rule{Name: "节点离线", Metric: "offline", Mode: "duration", WindowMinutes: 5}
			writeJSON(w, 200, AlertPreview{render("trigger", 5*time.Minute, 5), render("repeat", 15*time.Minute, 15), render("recovery", 18*time.Minute, 0)})
			return
		}
		writeJSON(w, 200, AlertPreview{render("trigger", 0, 91), render("repeat", 30*time.Minute, 92), render("recovery", 45*time.Minute, 70)})
	}))
}
