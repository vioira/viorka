package httpapi

import (
	"context"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/monitoring"
	"net/http"
	"time"
)

func (a *api) registerMetricHistory(routes routeRegistry) {
	routes.handle("GET /api/v1/nodes/{id}/metrics/history", "nodeMetricHistory", "viewer", 200, nil, monitoring.History{}, a.user("viewer", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		if _, err := a.Nodes.Node(r.Context(), r.PathValue("id")); err != nil {
			problem(w, err)
			return
		}
		hours, period := 1, 60
		switch r.URL.Query().Get("range") {
		case "", "1h":
		case "6h":
			hours = 6
		case "24h":
			hours = 24
			period = 300
		case "7d":
			hours = 168
			period = 900
		default:
			fail(w, 400, "invalid_range", "历史范围须为 1h、6h、24h 或 7d")
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
		writeJSON(w, 200, result)
	}))
}
