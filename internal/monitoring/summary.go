package monitoring

import (
	v1 "github.com/vioira/viorka/protocol/v1"
	"slices"
	"strconv"
	"time"
)

// MetricSummary is the list wire projection; nil values mean unavailable, never zero.
type MetricSummary struct {
	DailyTraffic       *v1.TelemetryDailyTraffic `json:"daily_traffic"`
	TrafficBillingMode string                    `json:"traffic_billing_mode"`
	TrafficExpiresAt   *time.Time                `json:"traffic_expires_at"`
	ReceivedAt         time.Time                 `json:"received_at"`
	ExpiresAt          time.Time                 `json:"expires_at"`
	CPU                *float64                  `json:"cpu"`
	Memory             *float64                  `json:"memory"`
}

func fastTTL(settings v1.TelemetrySettings, realtime bool) time.Duration {
	collection, report := settings.CollectionSeconds, settings.HttpReportSeconds
	if realtime {
		collection = settings.WssReportSeconds
		report = collection
	}
	return time.Duration(max(uint64(90), 3*collection, 3*report)) * time.Second
}

func Summarize(s Snapshot) MetricSummary {
	out := MetricSummary{ReceivedAt: s.ReceivedAt.UTC()}
	t := s.Telemetry
	if t == nil {
		return out
	}
	settings := v1.DefaultTelemetrySettings()
	if t.Settings != nil {
		settings = *t.Settings
	}
	out.DailyTraffic = t.DailyTraffic
	if t.Settings != nil {
		out.TrafficBillingMode = "both"
		if t.Settings.Traffic != nil {
			out.TrafficBillingMode = t.Settings.Traffic.BillingMode
		}
		if t.DailyTraffic != nil {
			expires := t.DailyTraffic.SampledAt.Add(time.Duration(settings.HttpReportSeconds+settings.CollectionSeconds+15) * time.Second).UTC()
			out.TrafficExpiresAt = &expires
		}
	}
	if t.Fast == nil {
		return out
	}
	ttl := fastTTL(settings, s.TelemetryControl != nil && s.TelemetryControl.Mode == "realtime")
	out.ExpiresAt = t.FastReceivedAt.Add(ttl).UTC()
	if sampled := t.Fast.SampledAt.Add(ttl); sampled.Before(out.ExpiresAt) {
		out.ExpiresAt = sampled.UTC()
	}
	if !slices.Contains(t.Fast.Errors, "cpu_unavailable") {
		out.CPU = t.Fast.CPUPercent
	}
	if !slices.Contains(t.Fast.Errors, "memory_unavailable") && t.Fast.RamUsed != nil && t.Fast.RamTotal != nil {
		used, err := strconv.ParseUint(*t.Fast.RamUsed, 10, 64)
		total, totalErr := strconv.ParseUint(*t.Fast.RamTotal, 10, 64)
		if err == nil && totalErr == nil && total > 0 {
			value := min(100, float64(used)/float64(total)*100)
			out.Memory = &value
		}
	}
	return out
}
