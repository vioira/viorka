package httpapi

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/vioira/viorka/internal/auth"
	v1 "github.com/vioira/viorka/protocol/v1"
)

type telemetrySettingsRepository interface {
	TelemetrySettings(context.Context, string) (v1.TelemetrySettings, error)
	SaveTelemetrySettings(context.Context, string, string, v1.TelemetrySettings) (v1.TelemetrySettings, error)
	TelemetrySettingsResult(context.Context, string) (*v1.TelemetrySettingsResult, error)
}
type TelemetrySettingsRequest struct {
	Revision          uint64 `json:"revision" minimum:"1" maximum:"9223372036854775807"`
	CollectionSeconds uint64 `json:"collection_seconds" minimum:"1" maximum:"60"`
	HTTPReportSeconds uint64 `json:"http_report_seconds" minimum:"30" maximum:"180"`
	WSSReportSeconds  uint64 `json:"wss_report_seconds" minimum:"1" maximum:"5"`
	ConnectionMode    string `json:"connection_mode" enum:"auto_http_wss"`
}
type TelemetrySettingsStatus struct {
	State  string                      `json:"state" enum:"pending,applied,failed"`
	Result *v1.TelemetrySettingsResult `json:"result,omitempty"`
}

func (a *api) telemetrySettingsStore(w http.ResponseWriter) (telemetrySettingsRepository, bool) {
	repo, ok := a.Nodes.(telemetrySettingsRepository)
	if !ok {
		fail(w, 503, "unavailable", "新版监控设置暂不可用")
	}
	return repo, ok
}
func (a *api) registerTelemetrySettings(routes routeRegistry) {
	routes.handle("GET /api/v1/nodes/{id}/telemetry-settings", "getTelemetrySettings", "viewer", 200, nil, TelemetrySettingsRequest{}, a.user("viewer", func(w http.ResponseWriter, r *http.Request, _ auth.Session) {
		if r.URL.RawQuery != "" {
			fail(w, 400, "invalid_query", "此接口不接受查询参数")
			return
		}
		repo, ok := a.telemetrySettingsStore(w)
		if !ok {
			return
		}
		settings, err := repo.TelemetrySettings(r.Context(), r.PathValue("id"))
		if err != nil {
			problem(w, err)
			return
		}
		writeJSON(w, 200, settings)
	}))
	routes.handle("GET /api/v1/nodes/{id}/telemetry-settings/status", "getTelemetrySettingsStatus", "viewer", 200, nil, TelemetrySettingsStatus{}, a.user("viewer", func(w http.ResponseWriter, r *http.Request, _ auth.Session) {
		if r.URL.RawQuery != "" {
			fail(w, 400, "invalid_query", "此接口不接受查询参数")
			return
		}
		repo, ok := a.telemetrySettingsStore(w)
		if !ok {
			return
		}
		result, err := repo.TelemetrySettingsResult(r.Context(), r.PathValue("id"))
		if err != nil {
			problem(w, err)
			return
		}
		status := TelemetrySettingsStatus{State: "pending", Result: result}
		if result != nil {
			status.State = result.State
		}
		writeJSON(w, 200, status)
	}))
	routes.handle("PUT /api/v1/nodes/{id}/telemetry-settings", "saveTelemetrySettings", "admin", 200, TelemetrySettingsRequest{}, TelemetrySettingsRequest{}, a.user("admin", func(w http.ResponseWriter, r *http.Request, user auth.Session) {
		if r.URL.RawQuery != "" {
			fail(w, 400, "invalid_query", "此接口不接受查询参数")
			return
		}
		repo, ok := a.telemetrySettingsStore(w)
		if !ok {
			return
		}
		var raw json.RawMessage
		if !decode(w, r, &raw) {
			return
		}
		var settings v1.TelemetrySettings
		if v1.ValidateTelemetryJSON(raw, "TelemetrySettings", true) != nil || v1.DecodeTelemetry(raw, &settings, true) != nil || settings.Validate() != nil {
			fail(w, 400, "invalid_settings", "采集间隔须为 1–60 秒，HTTP 上报须为 30–180 秒，WSS 实时上报须为 1–5 秒")
			return
		}
		saved, err := repo.SaveTelemetrySettings(r.Context(), user.User.ID, r.PathValue("id"), settings)
		if err != nil {
			problem(w, err)
			return
		}
		if a.Gateway != nil {
			a.Gateway.NotifyTelemetrySettings(r.PathValue("id"))
		}
		writeJSON(w, 200, saved)
	}))
}
