package httpapi

import (
	"context"
	"errors"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/proxy"

	"net/http"
	"strconv"
)

type outboundRepository interface {
	CopyOutbound(context.Context, string, string, string) (proxy.Outbound, error)
	Outbounds(context.Context, string, string, int) ([]proxy.Outbound, error)
	SaveOutbound(context.Context, string, string, proxy.OutboundEdit) (proxy.Outbound, error)
	PreviewOutbound(context.Context, string, string, proxy.OutboundEdit) (proxy.OutboundPreview, error)
	DeleteOutbound(context.Context, string, string, int64) error
}
type OutboundsResponse struct {
	Items      []proxy.Outbound `json:"items"`
	NextCursor string           `json:"next_cursor"`
}
type OutboundLinkRequest struct {
	Link string `json:"link"`
}
type OutboundDeleteRequest struct {
	Version int64 `json:"version"`
}

func outboundProblem(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, proxy.ErrInvalid):
		fail(w, 400, "outbound_invalid", "出口或分流参数无效。链接支持 VLESS TCP（无 TLS 或 REALITY），请检查地址、凭证及参数；HTTP 出口仅支持明确的 TCP 规则。")
	case errors.Is(err, proxy.ErrConflict):
		fail(w, 409, "outbound_conflict", "名称重复或出口仍被引用，请更换名称或先移除引用并应用配置。")
	case errors.Is(err, proxy.ErrPresetStale):
		fail(w, 409, "outbound_stale", "出口或引用范围已变化，请刷新并重新预览。")
	case errors.Is(err, proxy.ErrForbidden):
		fail(w, 403, "outbound_forbidden", "需要出口及全部引用节点的管理权限。")
	case errors.Is(err, proxy.ErrPresetLimit):
		fail(w, 409, "outbound_scope_limit", "引用节点超过单次修改上限 500。")
	case errors.Is(err, proxy.ErrUnavailable):
		fail(w, 503, "outbound_unavailable", "出口配置暂不可用，请稍后重试。")
	default:
		problem(w, err)
	}
}

type OutboundCopyRequest struct {
	Name string `json:"name"`
}

func (a *api) registerOutbounds(routes routeRegistry) {
	routes.handle("POST /api/v1/outbounds/{id}/copy", "copyOutbound", "operator", 201, OutboundCopyRequest{}, proxy.Outbound{}, a.user("operator", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		var req OutboundCopyRequest
		if !decode(w, r, &req) {
			return
		}
		repo, ok := a.Nodes.(outboundRepository)
		if !ok {
			outboundProblem(w, proxy.ErrUnavailable)
			return
		}
		o, err := repo.CopyOutbound(r.Context(), s.User.ID, r.PathValue("id"), req.Name)
		if err != nil {
			outboundProblem(w, err)
			return
		}
		writeJSON(w, 201, o)
	}))

	routes.handle("POST /api/v1/outbounds/parse", "parseOutboundLink", "operator", 200, OutboundLinkRequest{}, proxy.OutboundConfig{}, a.user("operator", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		var req OutboundLinkRequest
		if !decode(w, r, &req) {
			return
		}
		c, err := proxy.ParseOutboundLink(req.Link)
		if err != nil {
			outboundProblem(w, err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, 200, c)
	}))
	routes.handle("GET /api/v1/outbounds", "listOutbounds", "viewer", 200, nil, OutboundsResponse{}, a.user("viewer", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		limit := 50
		var err error
		for k, v := range r.URL.Query() {
			if (k != "limit" && k != "after") || len(v) != 1 {
				outboundProblem(w, proxy.ErrInvalid)
				return
			}
		}
		if v := r.URL.Query().Get("limit"); v != "" {
			limit, err = strconv.Atoi(v)
		}
		if err != nil || limit < 1 || limit > 100 {
			outboundProblem(w, proxy.ErrInvalid)
			return
		}
		repo, ok := a.Nodes.(outboundRepository)
		if !ok {
			outboundProblem(w, proxy.ErrUnavailable)
			return
		}
		items, err := repo.Outbounds(r.Context(), s.User.ID, r.URL.Query().Get("after"), limit)
		if err != nil {
			outboundProblem(w, err)
			return
		}
		res := OutboundsResponse{Items: items}
		if len(items) == limit {
			res.NextCursor = items[len(items)-1].ID
		}
		writeJSON(w, 200, res)
	}))
	for _, route := range []struct {
		method, path, operation string
		status                  int
	}{{"POST", "/api/v1/outbounds", "createOutbound", 201}, {"PUT", "/api/v1/outbounds/{id}", "updateOutbound", 200}} {
		routes.handle(route.method+" "+route.path, route.operation, "operator", route.status, proxy.OutboundEdit{}, proxy.Outbound{}, a.user("operator", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
			var edit proxy.OutboundEdit
			if !decode(w, r, &edit) {
				return
			}
			repo, ok := a.Nodes.(outboundRepository)
			if !ok {
				outboundProblem(w, proxy.ErrUnavailable)
				return
			}
			o, err := repo.SaveOutbound(r.Context(), s.User.ID, r.PathValue("id"), edit)
			if err != nil {
				outboundProblem(w, err)
				return
			}
			writeJSON(w, route.status, o)
		}))
	}
	routes.handle("POST /api/v1/outbounds/{id}/preview", "previewOutbound", "operator", 200, proxy.OutboundEdit{}, proxy.OutboundPreview{}, a.user("operator", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		var edit proxy.OutboundEdit
		if !decode(w, r, &edit) {
			return
		}
		repo, ok := a.Nodes.(outboundRepository)
		if !ok {
			outboundProblem(w, proxy.ErrUnavailable)
			return
		}
		p, err := repo.PreviewOutbound(r.Context(), s.User.ID, r.PathValue("id"), edit)
		if err != nil {
			outboundProblem(w, err)
			return
		}
		writeJSON(w, 200, p)
	}))
	routes.handle("DELETE /api/v1/outbounds/{id}", "deleteOutbound", "operator", 204, OutboundDeleteRequest{}, nil, a.user("operator", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		var req OutboundDeleteRequest
		if !decode(w, r, &req) {
			return
		}
		repo, ok := a.Nodes.(outboundRepository)
		if !ok {
			outboundProblem(w, proxy.ErrUnavailable)
			return
		}
		if err := repo.DeleteOutbound(r.Context(), s.User.ID, r.PathValue("id"), req.Version); err != nil {
			outboundProblem(w, err)
			return
		}
		w.WriteHeader(204)
	}))
}
