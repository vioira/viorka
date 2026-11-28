package httpapi

import (
	"context"
	"net/http"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/proxy"
	"github.com/vioira/viorka/internal/scheduler"
	"github.com/vioira/viorka/internal/subscription"
)

type relayRepository interface {
	RetestRelayPublic(context.Context, string, string, proxy.RelayRetest) (proxy.RelayPublicProbe, error)
	ProbeRelay(context.Context, string, string, proxy.RelayAction) (scheduler.Task, error)
	RelayRoutes(context.Context, string, string, string, string, string) ([]proxy.RelayRoute, error)
	RelayRoute(context.Context, string, string) (proxy.RelayRoute, error)
	RelayEntries(context.Context, string, string) ([]proxy.RelayEntry, error)
	RelayLanding(context.Context, string, string, string) (proxy.RelayPath, error)
	SaveRelay(context.Context, string, string, proxy.RelayEdit) (proxy.RelayRoute, error)
	RelayLandings(context.Context, string, string, int, string) ([]subscription.ServiceView, string, error)
	PublishRelay(context.Context, string, string, proxy.RelayPublishRequest) (scheduler.Task, error)
	WithdrawRelay(context.Context, string, string, proxy.RelayAction) (scheduler.Task, error)
	DeleteRelay(context.Context, string, string, int64) error
}
type RelayListResponse struct {
	Items      []proxy.RelayRoute `json:"items"`
	NextCursor string             `json:"next_cursor,omitempty"`
}
type RelayEntriesResponse struct {
	Items      []proxy.RelayEntry `json:"items"`
	NextCursor string             `json:"next_cursor,omitempty"`
}

func (a *api) registerRelays(routes routeRegistry) {
	type handler func(http.ResponseWriter, *http.Request, string, relayRepository)
	handle := func(method, id, role string, status int, in, out any, h handler) {
		routes.handle(method, id, role, status, in, out, a.user(role, func(w http.ResponseWriter, r *http.Request, s auth.Session) {
			repo, ok := a.Nodes.(relayRepository)
			if !ok {
				problem(w, proxy.ErrUnavailable)
				return
			}
			w.Header().Set("Cache-Control", "no-store")
			h(w, r, s.User.ID, repo)
		}))
	}
	handle("GET /api/v1/relays", "listRelays", "viewer", 200, nil, RelayListResponse{}, func(w http.ResponseWriter, r *http.Request, actor string, repo relayRepository) {
		q := r.URL.Query()
		for key, values := range q {
			if key != "after" && key != "landing_engine" && key != "entry_engine" && key != "service" || len(values) != 1 || !proxy.ValidID(values[0]) {
				problem(w, proxy.ErrInvalid)
				return
			}
		}
		items, err := repo.RelayRoutes(r.Context(), actor, q.Get("landing_engine"), q.Get("service"), q.Get("entry_engine"), q.Get("after"))
		if err != nil {
			subscriptionProblem(w, err)
			return
		}
		resp := RelayListResponse{Items: items}
		if len(items) == 50 {
			resp.NextCursor = items[49].ID
		}
		writeJSON(w, 200, resp)
	})
	handle("GET /api/v1/relays/{id}", "getRelay", "viewer", 200, nil, proxy.RelayRoute{}, func(w http.ResponseWriter, r *http.Request, actor string, repo relayRepository) {
		v, err := repo.RelayRoute(r.Context(), actor, r.PathValue("id"))
		if err != nil {
			subscriptionProblem(w, err)
			return
		}
		writeJSON(w, 200, v)
	})
	handle("GET /api/v1/relay-entries", "listRelayEngines", "operator", 200, nil, RelayEntriesResponse{}, func(w http.ResponseWriter, r *http.Request, actor string, repo relayRepository) {
		after := r.URL.Query().Get("after")
		if after != "" && !proxy.ValidID(after) {
			problem(w, proxy.ErrInvalid)
			return
		}
		items, err := repo.RelayEntries(r.Context(), actor, after)
		if err != nil {
			problem(w, err)
			return
		}
		resp := RelayEntriesResponse{Items: items}
		if len(items) == 50 {
			resp.NextCursor = items[49].ID
		}
		writeJSON(w, 200, resp)
	})
	handle("GET /api/v1/relay-landings", "listRelayLandings", "operator", 200, nil, SubscriptionServicesResponse{}, func(w http.ResponseWriter, r *http.Request, actor string, repo relayRepository) {
		limit, after, err := subscriptionPage(r, 20, "q")
		if err != nil {
			subscriptionProblem(w, err)
			return
		}
		items, next, err := repo.RelayLandings(r.Context(), actor, after, limit, r.URL.Query().Get("q"))
		if err != nil {
			subscriptionProblem(w, err)
			return
		}
		writeJSON(w, 200, SubscriptionServicesResponse{Items: items, NextCursor: next})
	})
	handle("GET /api/v1/engines/{id}/services/{service}/relay-landing", "getRelayLanding", "operator", 200, nil, proxy.RelayPath{}, func(w http.ResponseWriter, r *http.Request, actor string, repo relayRepository) {
		v, err := repo.RelayLanding(r.Context(), actor, r.PathValue("id"), r.PathValue("service"))
		if err != nil {
			subscriptionProblem(w, err)
			return
		}
		writeJSON(w, 200, v)
	})
	for _, route := range []struct {
		path, id string
		status   int
	}{{"POST /api/v1/relays", "createRelay", 201}, {"PUT /api/v1/relays/{id}", "editRelay", 200}} {
		handle(route.path, route.id, "operator", route.status, proxy.RelayEdit{}, proxy.RelayRoute{}, func(w http.ResponseWriter, r *http.Request, actor string, repo relayRepository) {
			var v proxy.RelayEdit
			if !decode(w, r, &v) {
				return
			}
			out, err := repo.SaveRelay(r.Context(), actor, r.PathValue("id"), v)
			if err != nil {
				subscriptionProblem(w, err)
				return
			}
			writeJSON(w, route.status, out)
		})
	}
	handle("POST /api/v1/relays/{id}/publish", "publishRelay", "operator", 202, proxy.RelayPublishRequest{}, TaskResponse{}, func(w http.ResponseWriter, r *http.Request, actor string, repo relayRepository) {
		var input proxy.RelayPublishRequest
		if !decode(w, r, &input) {
			return
		}
		t, err := repo.PublishRelay(r.Context(), actor, r.PathValue("id"), input)
		if err != nil {
			subscriptionProblem(w, err)
			return
		}
		writeJSON(w, 202, taskResponse(t))
	})
	for _, op := range []string{"withdraw", "probe"} {
		handle("POST /api/v1/relays/{id}/"+op, op+"Relay", "operator", 202, proxy.RelayAction{}, TaskResponse{}, func(w http.ResponseWriter, r *http.Request, actor string, repo relayRepository) {
			var v proxy.RelayAction
			if !decode(w, r, &v) {
				return
			}
			var t scheduler.Task
			var err error
			if op == "probe" {
				t, err = repo.ProbeRelay(r.Context(), actor, r.PathValue("id"), v)
			} else {
				t, err = repo.WithdrawRelay(r.Context(), actor, r.PathValue("id"), v)
			}
			if err != nil {
				subscriptionProblem(w, err)
				return
			}
			writeJSON(w, 202, taskResponse(t))
		})
	}
	handle("POST /api/v1/relays/{id}/public-probe", "retestRelayPublic", "operator", 202, proxy.RelayRetest{}, proxy.RelayPublicProbe{}, func(w http.ResponseWriter, r *http.Request, actor string, repo relayRepository) {
		var input proxy.RelayRetest
		if !decode(w, r, &input) {
			return
		}
		q, err := repo.RetestRelayPublic(r.Context(), actor, r.PathValue("id"), input)
		if err != nil {
			subscriptionProblem(w, err)
			return
		}
		writeJSON(w, 202, q)
	})
	handle("DELETE /api/v1/relays/{id}", "deleteRelay", "operator", 204, SubscriptionVersionRequest{}, nil, func(w http.ResponseWriter, r *http.Request, actor string, repo relayRepository) {
		var v SubscriptionVersionRequest
		if !decode(w, r, &v) {
			return
		}
		if err := repo.DeleteRelay(r.Context(), actor, r.PathValue("id"), v.Version); err != nil {
			subscriptionProblem(w, err)
			return
		}
		w.WriteHeader(204)
	})
}
