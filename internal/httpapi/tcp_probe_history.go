package httpapi

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/monitoring"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func configuredTCPProbeTargets(config *v1.TelemetryTCPProbeSettings) []string {
	if config == nil {
		return nil
	}
	return config.Targets
}

func (a *api) currentTCPProbeTargets(ctx context.Context, node string) ([]string, error) {
	reader, ok := a.Nodes.(telemetrySettingsRepository)
	if !ok {
		return nil, errors.New("telemetry settings unavailable")
	}
	settings, err := reader.TelemetrySettings(ctx, node)
	if err != nil {
		return nil, err
	}
	return configuredTCPProbeTargets(settings.TcpProbe), nil
}

func currentTCPProbes(batch *v1.TelemetryTCPProbeBatch, targets []string) *v1.TelemetryTCPProbeBatch {
	if batch == nil {
		return nil
	}
	filtered := &v1.TelemetryTCPProbeBatch{SampledAt: batch.SampledAt}
	for _, probe := range batch.Targets {
		if slices.Contains(targets, probe.Target) {
			filtered.Targets = append(filtered.Targets, probe)
		}
	}
	if len(filtered.Targets) == 0 {
		return nil
	}
	return filtered
}

func (a *api) registerTCPProbeHistory(routes routeRegistry) {
	routes.handle("GET /api/v1/nodes/{id}/tcp-probes/history", "nodeTCPProbeHistory", "viewer", 200, nil, monitoring.TCPHistory{}, a.user("viewer", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		targets, err := a.currentTCPProbeTargets(ctx, r.PathValue("id"))
		if err != nil {
			if errors.Is(err, auth.ErrNotFound) {
				problem(w, err)
			} else {
				fail(w, 503, "history_unavailable", "TCP 探测目标读取失败，请稍后重试")
			}
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
		if target != "" {
			if slices.Contains(targets, target) {
				targets = []string{target}
			} else {
				targets = nil
			}
		}
		result, err := a.TCPHistory.TCPProbeHistory(ctx, r.PathValue("id"), targets, start, end, now, period)
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
