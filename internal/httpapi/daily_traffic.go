package httpapi

import (
	"context"
	"github.com/vioira/viorka/internal/auth"
	v1 "github.com/vioira/viorka/protocol/v1"
	"net/http"
	"time"
)

type DailyTrafficResponse struct {
	Items []*v1.TelemetryDailyTraffic `json:"items"`
}

func (a *api) registerDailyTraffic(routes routeRegistry) {
	routes.handle("GET /api/v1/nodes/{id}/traffic/daily", "nodeDailyTraffic", "viewer", 200, nil, DailyTrafficResponse{}, a.user("viewer", func(w http.ResponseWriter, r *http.Request, _ auth.Session) {
		node := r.PathValue("id")
		if _, err := a.Nodes.Node(r.Context(), node); err != nil {
			problem(w, err)
			return
		}
		now := time.Now().UTC()
		start, end := now, now.Add(time.Millisecond)
		q := r.URL.Query()
		invalid := func() {
			fail(w, 400, "invalid_range", "请提供成对的 RFC3339 start、end，范围不超过 366 天")
		}
		for k, v := range q {
			if (k != "start" && k != "end") || len(v) != 1 {
				invalid()
				return
			}
		}
		if len(q) > 0 {
			var err error
			start, err = time.Parse(time.RFC3339Nano, q.Get("start"))
			if err != nil {
				invalid()
				return
			}
			end, err = time.Parse(time.RFC3339Nano, q.Get("end"))
			if err != nil || !end.After(start) || end.Sub(start) > 366*24*time.Hour {
				invalid()
				return
			}
		}
		if a.DailyTraffic == nil {
			fail(w, 503, "history_unavailable", "日流量存储不可用，请稍后重试")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		records, err := a.DailyTraffic.DailyTraffic(ctx, node, start, end)
		if err != nil {
			problem(w, err)
			return
		}
		writeJSON(w, 200, DailyTrafficResponse{Items: records})
	}))
}
