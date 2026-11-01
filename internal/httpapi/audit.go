package httpapi

import (
	"github.com/vioira/viorka/internal/auth"
	"net/http"
	"strconv"
)

type AuditRecord struct {
	ID           string `json:"id"`
	Kind         string `json:"kind" enum:"user,system"`
	ActorID      string `json:"actor_id"`
	Actor        string `json:"actor"`
	Action       string `json:"action"`
	ResourceType string `json:"resource_type"`
	ResourceID   string `json:"resource_id"`
	SourceIP     string `json:"source_ip"`
	CreatedAt    string `json:"created_at"`
}
type AuditLogsResponse struct {
	Items      []AuditRecord `json:"items"`
	NextCursor string        `json:"next_cursor"`
}

func (a *api) registerAudit(routes routeRegistry) {
	routes.handle("GET /api/v1/audit-logs", "listAuditLogs", "admin", 200, nil, AuditLogsResponse{}, a.user("admin", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		q := r.URL.Query()
		limit := 50
		var err error
		for key, values := range q {
			if (key != "limit" && key != "after" && key != "kind") || len(values) != 1 {
				problem(w, auth.ErrInvalid)
				return
			}
		}
		if q.Has("limit") {
			limit, err = strconv.Atoi(q.Get("limit"))
		}
		kind := q.Get("kind")
		if kind == "" {
			kind = "all"
		}
		after := q.Get("after")
		if err != nil || limit < 1 || limit > 100 || len(after) > 128 || (kind != "all" && kind != "user" && kind != "system") {
			problem(w, auth.ErrInvalid)
			return
		}
		if a.Audit == nil {
			fail(w, 503, "audit_unavailable", "审计存储不可用，请稍后重试")
			return
		}
		items, err := a.Audit.AuditLogs(r.Context(), limit+1, after, kind)
		if err != nil {
			problem(w, err)
			return
		}
		result := AuditLogsResponse{Items: make([]AuditRecord, 0)}
		if len(items) > limit {
			items = items[:limit]
			result.NextCursor = items[len(items)-1].ID
		}
		for _, v := range items {
			k := "user"
			if v.ActorID == "" {
				k = "system"
			}
			result.Items = append(result.Items, AuditRecord{v.ID, k, v.ActorID, v.Actor, v.Action, v.ResourceType, v.ResourceID, v.SourceIP, v.CreatedAt})
		}
		writeJSON(w, 200, result)
	}))
}
