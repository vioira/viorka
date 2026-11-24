package inventory

import v1 "github.com/vioira/viorka/protocol/v1"

type NodeSettingsResult struct {
	Billing   *Billing              `json:"billing,omitempty"`
	Telemetry *v1.TelemetrySettings `json:"telemetry,omitempty"`
}
