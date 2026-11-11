package httpapi

import (
	"context"
	"net/http"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/proxy"
	"github.com/vioira/viorka/internal/scheduler"
	v1 "github.com/vioira/viorka/protocol/v1"
)

type engineRepository interface {
	EngineConfiguration(context.Context, string, string, string) (proxy.EngineConfigurationResult, error)
	RetryEngineSync(context.Context, string, string) error
	proxy.Repository
	EngineConnections(context.Context, string, string) ([]proxy.Connection, error)
	InstallEngine(context.Context, string, string, string, proxy.Action) (scheduler.Task, error)
	EngineAction(context.Context, string, string, proxy.Action) (scheduler.Task, error)
	SetEngineGrant(context.Context, string, string, proxy.Grant) error
}
type EngineDetailSummary struct {
	LastError            string `json:"last_error"`
	SyncState            string `json:"sync_state"`
	SyncError            string `json:"sync_error"`
	ObservedAt           string `json:"observed_at"`
	ID                   string `json:"id"`
	NodeID               string `json:"node_id"`
	Name                 string `json:"name"`
	Version              string `json:"version"`
	Ownership            string `json:"ownership"`
	Status               string `json:"status"`
	RunIntent            string `json:"run_intent"`
	DesiredRevision      int64  `json:"desired_revision"`
	ObservedRevision     int64  `json:"observed_revision"`
	ExternalConnectivity string `json:"external_connectivity"`
	DraftVersion         int64  `json:"draft_version"`
	ServiceCount         int    `json:"service_count"`
}

func summarizeEngine(e proxy.Engine) EngineDetailSummary {
	count := 0
	for _, service := range e.Draft.Services {
		if !service.PendingDelete {
			count++
		}
	}
	return EngineDetailSummary{LastError: e.LastError, SyncState: e.SyncState, SyncError: e.SyncError, ObservedAt: e.ObservedAt, ID: e.ID, NodeID: e.NodeID, Name: e.Name, Version: e.Version, Ownership: e.Ownership, Status: e.Status, RunIntent: e.RunIntent, DesiredRevision: e.DesiredRevision, ObservedRevision: e.ObservedRevision, ExternalConnectivity: e.ExternalConnectivity, DraftVersion: e.Draft.Version, ServiceCount: count}
}

type EnginesResponse struct {
	Items []EngineDetailSummary `json:"items"`
}
type EngineLocalApplyResponse struct {
	LocalOnly bool `json:"local_only"`
}

type InstallEngineRequest struct {
	Name           string `json:"name"`
	IdempotencyKey string `json:"idempotency_key"`
	Confirm        bool   `json:"confirm"`
}
type EngineDraftRequest struct {
	Routing  *proxy.Routing  `json:"routing,omitempty"`
	Version  int64           `json:"version"`
	Services []proxy.Service `json:"services"`
}
type EngineCatalogItem struct {
	Name       string `json:"name"`
	Version    string `json:"version"`
	Acceptance string `json:"acceptance"`
}

func (a *api) registerEngines(routes routeRegistry) {
	repository := func(w http.ResponseWriter) (engineRepository, bool) {
		r, ok := a.Nodes.(engineRepository)
		if !ok {
			problem(w, proxy.ErrUnavailable)
		}
		return r, ok
	}
	routes.handle("GET /api/v1/engines/{id}/configuration/{task}", "getEngineConfiguration", "operator", 200, nil, proxy.EngineConfigurationResult{}, a.user("operator", func(w http.ResponseWriter, r *http.Request, session auth.Session) {
		repo, ok := repository(w)
		if !ok {
			return
		}
		result, err := repo.EngineConfiguration(r.Context(), session.User.ID, r.PathValue("id"), r.PathValue("task"))
		if err != nil {
			problem(w, err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, 200, result)
	}))

	routes.handle("POST /api/v1/engines/{id}/sync", "retryEngineSync", "operator", 204, nil, nil, a.user("operator", func(w http.ResponseWriter, r *http.Request, session auth.Session) {
		repo, ok := repository(w)
		if !ok {
			return
		}
		if err := repo.RetryEngineSync(r.Context(), session.User.ID, r.PathValue("id")); err != nil {
			problem(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	routes.handle("POST /api/v1/engines/{id}/connections", "engineConnections", "viewer", 200, nil, []proxy.Connection{}, a.user("viewer", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		repo, ok := repository(w)
		if !ok {
			return
		}
		items, err := repo.EngineConnections(r.Context(), s.User.ID, r.PathValue("id"))
		if err != nil {
			problem(w, err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, 200, items)
	}))
	routes.handle("GET /api/v1/engine-catalog", "engineCatalog", "viewer", 200, nil, []EngineCatalogItem{}, a.user("viewer", func(w http.ResponseWriter, r *http.Request, _ auth.Session) {
		items := []EngineCatalogItem{}
		for _, name := range []string{"sing-box", "xray", "realm"} {
			items = append(items, EngineCatalogItem{Name: name, Version: v1.EngineVersion(name), Acceptance: "development"})
		}
		writeJSON(w, 200, items)
	}))
	routes.handle("GET /api/v1/nodes/{id}/engines", "listEngines", "viewer", 200, nil, EnginesResponse{}, a.user("viewer", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		repo, ok := repository(w)
		if !ok {
			return
		}
		items, err := proxy.New(repo).List(r.Context(), s.User.ID, r.PathValue("id"))
		if err != nil {
			problem(w, err)
			return
		}
		summaries := make([]EngineDetailSummary, 0, len(items))
		for _, item := range items {
			summaries = append(summaries, summarizeEngine(item))
		}
		writeJSON(w, 200, EnginesResponse{summaries})
	}))
	routes.handle("POST /api/v1/nodes/{id}/engines", "installEngine", "admin", 202, InstallEngineRequest{}, TaskResponse{}, a.user("admin", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		var v InstallEngineRequest
		if !decode(w, r, &v) {
			return
		}
		repo, ok := repository(w)
		if !ok {
			return
		}
		t, err := repo.InstallEngine(r.Context(), s.User.ID, r.PathValue("id"), v.Name, proxy.Action{Operation: "engine.install", IdempotencyKey: v.IdempotencyKey, Confirm: v.Confirm})
		if err != nil {
			problem(w, err)
			return
		}
		writeJSON(w, 202, taskResponse(t))
	}))
	routes.handle("GET /api/v1/engines/{id}", "getEngine", "viewer", 200, nil, proxy.Engine{}, a.user("viewer", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		repo, ok := repository(w)
		if !ok {
			return
		}
		e, err := proxy.New(repo).Get(r.Context(), s.User.ID, r.PathValue("id"))
		if err != nil {
			problem(w, err)
			return
		}
		writeJSON(w, 200, e)
	}))
	routes.handle("PUT /api/v1/engines/{id}/draft", "saveEngineDraft", "operator", 200, EngineDraftRequest{}, proxy.Draft{}, a.user("operator", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		var v EngineDraftRequest
		if !decode(w, r, &v) {
			return
		}
		repo, ok := repository(w)
		if !ok {
			return
		}
		d, err := proxy.New(repo).SaveDraft(r.Context(), s.User.ID, r.PathValue("id"), proxy.Draft{Version: v.Version, Services: v.Services, Routing: v.Routing})
		if err != nil {
			problem(w, err)
			return
		}
		writeJSON(w, 200, d)
	}))
	routes.handle("POST /api/v1/engines/{id}/actions", "engineAction", "operator", 202, proxy.Action{}, TaskResponse{}, a.user("operator", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		var v proxy.Action
		if !decode(w, r, &v) {
			return
		}
		repo, ok := repository(w)
		if !ok {
			return
		}
		t, err := repo.EngineAction(r.Context(), s.User.ID, r.PathValue("id"), v)
		if err != nil {
			problem(w, err)
			return
		}
		if t.ID == "" {
			writeJSON(w, http.StatusOK, EngineLocalApplyResponse{LocalOnly: true})
			return
		}
		writeJSON(w, 202, taskResponse(t))
	}))
	routes.handle("PUT /api/v1/nodes/{id}/engine-access", "grantEngineAccess", "admin", 204, proxy.Grant{}, nil, a.user("admin", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		var v proxy.Grant
		if !decode(w, r, &v) {
			return
		}
		repo, ok := repository(w)
		if !ok {
			return
		}
		if err := repo.SetEngineGrant(r.Context(), s.User.ID, r.PathValue("id"), v); err != nil {
			problem(w, err)
			return
		}
		w.WriteHeader(204)
	}))
}
