package httpapi

import (
	"context"
	"github.com/vioira/viorka/internal/auth"

	"net/http"
	"time"
)

func (a *api) registerMetricHistory(routes routeRegistry) {
	routes.handle("GET /api/v1/nodes/{id}/metrics/history", "nodeMetricHistory", "viewer", 200, nil, HistoryResponse{}, a.user("viewer", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		if _, err := a.Nodes.Node(r.Context(), r.PathValue("id")); err != nil {
			problem(w, err)
			return
		}
		duration, period := time.Hour, 30
		switch r.URL.Query().Get("range") {
		case "", "1h":
		case "10m":
			duration = 10 * time.Minute
		case "6h":
			duration = 6 * time.Hour
			period = 180
		case "24h":
			duration = 24 * time.Hour
			period = 720
		case "2d":
			duration = 48 * time.Hour
			period = 1440
		case "7d":
			duration = 168 * time.Hour
			period = 3600
		default:
			fail(w, 400, "invalid_range", "历史范围须为 10m、1h、6h、24h、2d 或 7d")
			return
		}
		if r.URL.Query().Has("period_seconds") {
			if r.URL.Query().Get("range") != "10m" || r.URL.Query().Get("period_seconds") != "60" {
				fail(w, 400, "invalid_period", "period_seconds 仅支持 10m 范围使用 60 秒粒度")
				return
			}
			period = 60
		}
		if a.History == nil {
			fail(w, 503, "history_unavailable", "历史存储不可用，请稍后重试")
			return
		}
		end := time.Now().UTC()
		if period == 60 {
			end = end.Truncate(time.Minute)
		}
		start := end.Add(-duration)
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		result, err := a.History.MetricHistory(ctx, r.PathValue("id"), start, end, period)
		if err != nil {
			problem(w, err)
			return
		}
		writeJSON(w, 200, historyResponse(result))
	}))
}
