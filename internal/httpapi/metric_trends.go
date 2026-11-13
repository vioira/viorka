package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/monitoring"
)

// Seed from persistent aggregates once; cursor reads supply only new observations.
func (a *api) metricTrends(ctx context.Context, node string, value monitoring.LiveSnapshot, trend **monitoring.MetricTrendWindows, reset bool) (monitoring.LiveSnapshot, error) {
	now := time.Now().UTC()
	var delta monitoring.MetricTrends
	initial := reset || *trend == nil
	started := now
	if !initial {
		started = (*trend).StartedAt
	}
	var incoming []monitoring.TelemetryLivePoint
	if value.Telemetry != nil && !initial {
		for _, point := range value.Telemetry.Points {
			if !point.ReceivedAt.Before(started) {
				incoming = append(incoming, point)
			}
		}
	}
	if reset || value.Reset || *trend == nil {
		if a.History == nil {
			return value, errors.New("metric history unavailable")
		}
		end := now.Truncate(30 * time.Second)
		query, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		history, err := a.History.MetricHistory(query, node, end.Add(-monitoring.LiveWindow), end, 30)
		if err != nil {
			return value, err
		}
		*trend, delta = monitoring.NewMetricTrendWindows(history, end.Add(-monitoring.LiveWindow), end)
		(*trend).StartedAt = started
		if !initial {
			(*trend).Update(incoming, now)
			delta = (*trend).Snapshot()
		}
	} else {
		delta = (*trend).Update(incoming, now)
	}
	value.MetricTrends = delta
	if value.Telemetry != nil {
		t := *value.Telemetry
		value.Telemetry = &t
		// All chart points are carried by bounded per-chart deltas, never duplicated.
		t.Points = []monitoring.TelemetryLivePoint{}
	}
	return value, nil
}

// MetricTrendHistory returns display-ready chart windows, including unknown buckets.
type MetricTrendHistory struct {
	Start  time.Time               `json:"start"`
	End    time.Time               `json:"end"`
	Charts monitoring.MetricTrends `json:"charts"`
}

func (a *api) registerMetricTrends(routes routeRegistry) {
	routes.handle("GET /api/v1/nodes/{id}/metrics/trends", "nodeMetricTrends", "viewer", 200, nil, MetricTrendHistory{}, a.user("viewer", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		q := r.URL.Query()
		for key, values := range q {
			if key != "range" || len(values) != 1 {
				fail(w, 400, "invalid_query", "仅支持单个 range 参数")
				return
			}
		}
		duration, period := time.Hour, 30
		switch q.Get("range") {
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
			period = 5040
		default:
			fail(w, 400, "invalid_range", "历史范围须为 10m、1h、6h、24h、2d 或 7d")
			return
		}
		if _, err := a.Nodes.Node(r.Context(), r.PathValue("id")); err != nil {
			problem(w, err)
			return
		}
		if a.History == nil {
			fail(w, 503, "history_unavailable", "历史存储不可用，请稍后重试")
			return
		}
		end := time.Unix(time.Now().Unix()/int64(period)*int64(period), 0).UTC()
		start := end.Add(-duration)
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		history, err := a.History.MetricHistory(ctx, r.PathValue("id"), start, end, period)
		if err != nil {
			problem(w, err)
			return
		}
		_, charts := monitoring.NewMetricTrendWindows(history, start, end)
		writeJSON(w, 200, MetricTrendHistory{Start: start, End: end, Charts: charts})
	}))
}
