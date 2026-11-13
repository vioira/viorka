package inventory

import "github.com/vioira/viorka/internal/scheduler"

type OverviewAttention struct {
	NodeID string `json:"node_id"`
	Title  string `json:"title"`
	Detail string `json:"detail"`
	Tone   string `json:"tone"`
}
type Overview struct {
	Nodes           int                 `json:"nodes"`
	Online          int                 `json:"online"`
	Offline         int                 `json:"offline"`
	Pending         int                 `json:"pending"`
	Disabled        int                 `json:"disabled"`
	Services        int                 `json:"services"`
	Synced          int                 `json:"synced"`
	PendingServices int                 `json:"pending_services"`
	FailedServices  int                 `json:"failed_services"`
	Tasks           scheduler.Summary   `json:"tasks"`
	Attention       []OverviewAttention `json:"attention"`
}
type OverviewTrafficPoint struct {
	Date           string  `json:"date"`
	RX             *string `json:"rx_bytes"`
	TX             *string `json:"tx_bytes"`
	ReportingNodes int     `json:"reporting_nodes"`
	Partial        bool    `json:"partial"`
	SampledAt      string  `json:"sampled_at"`
}
type OverviewTraffic struct {
	Start         string                 `json:"start"`
	End           string                 `json:"end"`
	Timezone      string                 `json:"timezone"`
	ExpectedNodes int                    `json:"expected_nodes"`
	RX            *string                `json:"rx_bytes"`
	TX            *string                `json:"tx_bytes"`
	Partial       bool                   `json:"partial"`
	Points        []OverviewTrafficPoint `json:"points"`
}
