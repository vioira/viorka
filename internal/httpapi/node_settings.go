package httpapi

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/inventory"
	v1 "github.com/vioira/viorka/protocol/v1"
)

type NodeSettingsRequest struct {
	Billing   *inventory.BillingUpdate  `json:"billing,omitempty"`
	Telemetry *TelemetrySettingsRequest `json:"telemetry,omitempty"`
}

func (a *api) saveNodeSettings(w http.ResponseWriter, r *http.Request, user auth.Session) {
	var body struct {
		Billing   *inventory.BillingUpdate `json:"billing"`
		Telemetry json.RawMessage          `json:"telemetry"`
	}
	if !decode(w, r, &body) {
		return
	}
	id := r.PathValue("id")
	if r.URL.RawQuery != "" || len(id) > 128 || (body.Billing == nil && body.Telemetry == nil) {
		problem(w, auth.ErrInvalid)
		return
	}
	var telemetry *v1.TelemetrySettings
	if body.Telemetry != nil {
		telemetry = new(v1.TelemetrySettings)
		if !decodeTelemetrySettings(w, body.Telemetry, telemetry) {
			return
		}
	}
	repo, ok := a.Nodes.(interface {
		SaveNodeSettings(context.Context, string, string, *inventory.BillingUpdate, *v1.TelemetrySettings) (inventory.NodeSettingsResult, error)
	})
	if !ok {
		fail(w, 503, "unavailable", "节点设置暂不可用")
		return
	}
	result, err := repo.SaveNodeSettings(r.Context(), user.User.ID, id, body.Billing, telemetry)
	if err != nil {
		problem(w, err)
		return
	}
	if telemetry != nil && a.Gateway != nil {
		a.Gateway.NotifyTelemetrySettings(id)
	}
	writeJSON(w, 200, result)
}
