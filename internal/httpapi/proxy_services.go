package httpapi

import (
	"context"
	"net/http"
	"slices"
	"strings"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/proxy"
)

type proxyServiceRepository interface {
	ProxyServices(context.Context, string, proxy.ServiceListQuery) (proxy.ServiceList, error)
}

func validServiceKey(value string) bool {
	engine, service, ok := strings.Cut(value, "/")
	return value == "" || ok && proxy.ValidID(engine) && proxy.ValidID(service)
}

func (a *api) registerProxyServices(routes routeRegistry) {
	routes.handle("GET /api/v1/proxy/services", "listProxyServices", "viewer", 200, nil, proxy.ServiceList{}, a.user("viewer", func(w http.ResponseWriter, r *http.Request, session auth.Session) {
		limit, after, err := subscriptionPage(r, 50, "selected", "node", "engine", "status", "access", "q")
		if err != nil {
			subscriptionProblem(w, err)
			return
		}
		v := r.URL.Query()
		q := proxy.ServiceListQuery{
			Limit: limit, After: after, Selected: v.Get("selected"), Search: v.Get("q"),
			Node: v.Get("node"), Engine: v.Get("engine"), Status: v.Get("status"), Access: v.Get("access"),
		}
		if !validServiceKey(after) || !validServiceKey(q.Selected) ||
			q.Node != "" && !proxy.ValidID(q.Node) || q.Engine != "" && !proxy.ValidEngine(q.Engine) ||
			!slices.Contains([]string{"", "running", "pending", "attention"}, q.Status) ||
			!slices.Contains([]string{"", "direct", "relayed"}, q.Access) {
			problem(w, proxy.ErrInvalid)
			return
		}
		repo, ok := a.Nodes.(proxyServiceRepository)
		if !ok {
			problem(w, proxy.ErrUnavailable)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		result, err := repo.ProxyServices(r.Context(), session.User.ID, q)
		if err != nil {
			problem(w, err)
			return
		}
		writeJSON(w, 200, result)
	}))
}
