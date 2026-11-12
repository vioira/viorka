package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/monitoring"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func (a *api) registerTCPProbeHistory(routes routeRegistry) {
	routes.handle("GET /api/v1/nodes/{id}/tcp-probes/history", "nodeTCPProbeHistory", "viewer", 200, nil, monitoring.TCPHistory{}, a.user("viewer", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		if _, err := a.Nodes.Node(r.Context(), r.PathValue("id")); err != nil {
			problem(w, err)
			return
		}
		q := r.URL.Query()
		invalid := func() {
			fail(w, 400, "invalid_range", "TCP 历史范围须在最近 7 天内，粒度为 60、300、900 或 3600 秒，每条线路最多 240 格")
		}
		for key, values := range q {
			if len(values) != 1 {
				invalid()
				return
			}
			switch key {
			case "range", "start", "end", "period_seconds", "target":
			default:
				invalid()
				return
			}
		}
		duration, period := time.Hour, 60
		switch q.Get("range") {
		case "", "1h":
		case "6h":
			duration = 6 * time.Hour
			period = 300
		case "24h":
			duration = 24 * time.Hour
			period = 900
		case "7d":
			duration = 168 * time.Hour
			period = 3600
		default:
			invalid()
			return
		}
		now := time.Now().UTC()
		start, end := now.Add(-duration), now
		if q.Has("start") || q.Has("end") {
			var err error
			if q.Has("range") {
				invalid()
				return
			}
			start, err = time.Parse(time.RFC3339Nano, q.Get("start"))
			if err != nil {
				invalid()
				return
			}
			end, err = time.Parse(time.RFC3339Nano, q.Get("end"))
			if err != nil {
				invalid()
				return
			}
		}
		if q.Has("period_seconds") {
			var err error
			period, err = strconv.Atoi(q.Get("period_seconds"))
			if err != nil {
				invalid()
				return
			}
		}
		if err := monitoring.ValidateTCPHistoryRange(start, end, now, period); err != nil {
			invalid()
			return
		}
		target := q.Get("target")
		if target != "" && v1.ValidateTCPProbeTargets([]string{target}) != nil {
			fail(w, 400, "invalid_target", "TCP 目标须为公网 host:port")
			return
		}
		if a.TCPHistory == nil {
			fail(w, 503, "history_unavailable", "历史存储不可用，请稍后重试")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		result, err := a.TCPHistory.TCPProbeHistory(ctx, r.PathValue("id"), target, start, end, now, period)
		if errors.Is(err, monitoring.ErrTCPHistoryRange) {
			invalid()
			return
		}
		if err != nil {
			problem(w, err)
			return
		}
		writeJSON(w, 200, result)
	}))
}
