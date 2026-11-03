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
		hours, period := 1, 30
		switch r.URL.Query().Get("range") {
		case "", "1h":
		case "6h":
			hours = 6
			period = 180
		case "24h":
			hours = 24
			period = 720
		case "2d":
			hours = 48
			period = 1440
		case "7d":
			hours = 168
			period = 3600
		default:
			fail(w, 400, "invalid_range", "历史范围须为 1h、6h、24h、2d 或 7d")
			return
		}
		if a.History == nil {
			fail(w, 503, "history_unavailable", "历史存储不可用，请稍后重试")
			return
		}
		end := time.Now().UTC()
		start := end.Add(-time.Duration(hours) * time.Hour)
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
