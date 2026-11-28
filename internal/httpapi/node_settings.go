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
	Domain         *string                   `json:"domain,omitempty" maxLength:"254" doc:"Public DNS hostname, or an empty string to clear."`
	ExpectedDomain *string                   `json:"expected_domain,omitempty" maxLength:"253" doc:"Previously read domain, empty when unset. Required with domain."`
	Billing        *inventory.BillingUpdate  `json:"billing,omitempty"`
	Telemetry      *TelemetrySettingsRequest `json:"telemetry,omitempty"`
}

func (a *api) saveNodeSettings(w http.ResponseWriter, r *http.Request, user auth.Session) {
	var body struct {
		Domain         *string                  `json:"domain"`
		ExpectedDomain *string                  `json:"expected_domain"`
		Billing        *inventory.BillingUpdate `json:"billing"`
		Telemetry      json.RawMessage          `json:"telemetry"`
	}
	if !decode(w, r, &body) {
		return
	}
	id := r.PathValue("id")
	empty := body.Domain == nil && body.Billing == nil && body.Telemetry == nil
	missingDomainField := (body.Domain == nil) != (body.ExpectedDomain == nil)
	if r.URL.RawQuery != "" || len(id) > 128 || empty || missingDomainField {
		problem(w, auth.ErrInvalid)
		return
	}
	var domain *inventory.DomainUpdate
	if body.Domain != nil {
		value, valid := inventory.NormalizeNodeDomain(*body.Domain)
		if !valid || len(*body.Domain) > 254 || len(*body.ExpectedDomain) > 253 {
			fail(w, 400, "invalid_domain", "请输入有效域名，例如 node.example.com，或留空以使用公网 IP。")
			return
		}
		domain = &inventory.DomainUpdate{Value: value, Expected: *body.ExpectedDomain}
	}
	var telemetry *v1.TelemetrySettings
	if body.Telemetry != nil {
		telemetry = new(v1.TelemetrySettings)
		if !decodeTelemetrySettings(w, body.Telemetry, telemetry) {
			return
		}
	}
	repo, ok := a.Nodes.(interface {
		SaveNodeSettings(context.Context, string, string, *inventory.DomainUpdate, *inventory.BillingUpdate, *v1.TelemetrySettings) (inventory.NodeSettingsResult, error)
	})
	if !ok {
		fail(w, 503, "unavailable", "节点设置暂不可用")
		return
	}
	result, err := repo.SaveNodeSettings(r.Context(), user.User.ID, id, domain, body.Billing, telemetry)
	if err != nil {
		problem(w, err)
		return
	}
	if telemetry != nil && a.Gateway != nil {
		a.Gateway.NotifyTelemetrySettings(id)
	}
	writeJSON(w, 200, result)
}
