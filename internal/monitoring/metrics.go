package monitoring

import "time"

const MaxNodes = 1024

type Point struct {
	At     time.Time `json:"at"`
	CPU    *float64  `json:"cpu,omitempty"`
	Memory *float64  `json:"memory,omitempty"`
	RX     *float64  `json:"rx,omitempty"`
	TX     *float64  `json:"tx,omitempty"`
}
type Snapshot struct {
	MetricTrends     MetricTrends            `json:"metric_trends,omitempty"`
	ManagementOnline bool                    `json:"management_online"`
	Telemetry        *TelemetryLiveSnapshot  `json:"telemetry,omitempty"`
	TelemetryControl *TelemetryControlStatus `json:"telemetry_control,omitempty"`
	ReceivedAt       time.Time               `json:"received_at"`
	Stale            bool                    `json:"stale"`
	History          []Point                 `json:"history"`
}

func ptr(n float64) *float64 { return &n }
