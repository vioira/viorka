package monitoring

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
	"time"

	v1 "github.com/vioira/viorka/protocol/v1"
)

func TestTelemetryViewsExactIntegersAndOwnership(t *testing.T) {
	now := time.Now()
	large := uint64(9007199254740993)
	zero := uint64(0)
	percent := 12.5
	fast := &v1.TelemetryFast{Sequence: math.MaxInt64, SampledAt: now, CPUPercent: &percent, RamTotal: &large, SwapUsed: &zero, Interfaces: []*v1.TelemetryInterface{{Name: "eth0", Ifindex: 2, RXBytes: large, Quality: []string{"baseline"}}}, Traffic: &v1.TelemetryTraffic{RXBytes: &large, Quality: []string{"partial"}}, Errors: []string{"uptime_unavailable"}}
	view := telemetryFastView(fast)
	raw, err := json.Marshal(view)
	if err != nil {
		t.Fatal(err)
	}
	for _, part := range []string{`"sequence":"9223372036854775807"`, `"ram_total":"9007199254740993"`, `"swap_used":"0"`, `"rx_bytes":"9007199254740993"`} {
		if !strings.Contains(string(raw), part) {
			t.Fatalf("lost exact value %s in %s", part, raw)
		}
	}
	if view.RamUsed != nil {
		t.Fatal("unknown memory became zero")
	}
	percent = 99
	large = 0
	fast.Interfaces[0].Name = "changed"
	fast.Interfaces[0].Quality[0] = "unknown"
	fast.Traffic.Quality[0] = "unknown"
	fast.Errors[0] = "changed"
	if *view.CPUPercent != 12.5 || *view.RamTotal != "9007199254740993" || view.Interfaces[0].Name != "eth0" || view.Interfaces[0].Quality[0] != "baseline" || view.Traffic.Quality[0] != "partial" || view.Errors[0] != "uptime_unavailable" {
		t.Fatal("view aliases mutable input")
	}
	capacity := uint64(math.MaxInt64)
	full := telemetryFullView(&v1.TelemetryFull{DiskIo: &v1.TelemetryDiskIO{Quality: []string{"partial"}}, DiskTotal: &capacity, Errors: []string{}})
	if full.DiskIo.Quality[0] != "partial" || *full.DiskTotal != "9223372036854775807" {
		t.Fatal("device counters rounded")
	}
}
func TestTelemetryGroupFreshnessIndependentOfCachedReceipt(t *testing.T) {
	now := time.Now()
	settings := v1.DefaultTelemetrySettings()
	snapshot := TelemetrySnapshot{MetricsReceivedAt: now.Add(181 * time.Second), Fast: &TelemetryFastView{SampledAt: now}, FastReceivedAt: now, Full: &TelemetryFullView{SampledAt: now.Add(time.Minute)}, FullReceivedAt: now.Add(time.Minute), PublicIP: &TelemetryPublicIPView{SampledAt: now}, PublicIPReceivedAt: now}
	view := snapshot.freshness(now.Add(181*time.Second), settings, false)
	if !view.FastStale || view.FullStale || view.PublicIPStale {
		t.Fatal("receipt refreshed old sample or group ages conflated")
	}
	view = snapshot.freshness(now.Add(91*time.Second), settings, true)
	if !view.FastStale || view.FullStale {
		t.Fatal("realtime fast TTL not independent of full R")
	}
	view = snapshot.freshness(now.Add(1800*time.Second), settings, false)
	if !view.PublicIPStale {
		t.Fatal("old public IP stays fresh")
	}
	missing := (TelemetrySnapshot{}).freshness(now, settings, false)
	if !missing.FastStale || !missing.FullStale || !missing.PublicIPStale {
		t.Fatal("missing observations marked fresh")
	}
}

func TestListSummaryExpiryAndUnknownValues(t *testing.T) {
	now := time.Now().In(time.FixedZone("UTC+8", 8*60*60))
	zero, used, total := 0.0, "9007199254740993", "18014398509481986"
	settings := v1.DefaultTelemetrySettings()
	snapshot := Snapshot{ReceivedAt: now.Add(time.Minute), Telemetry: &TelemetryLiveSnapshot{TelemetrySnapshot: TelemetrySnapshot{Fast: &TelemetryFastView{SampledAt: now, CPUPercent: &zero, RamUsed: &used, RamTotal: &total}, FastReceivedAt: now.Add(time.Second)}, Settings: &settings}, TelemetryControl: &TelemetryControlStatus{Mode: "realtime"}}
	summary := Summarize(snapshot)
	if summary.CPU == nil || *summary.CPU != 0 || summary.Memory == nil || *summary.Memory != 50 || !summary.ExpiresAt.Equal(now.Add(90*time.Second)) {
		t.Fatal(summary)
	}
	if summary.ReceivedAt.Location() != time.UTC || summary.ExpiresAt.Location() != time.UTC {
		t.Fatal("summary timestamps are not UTC", summary)
	}
	raw, err := json.Marshal(summary)
	if err != nil || strings.Contains(string(raw), "+08:00") || strings.Count(string(raw), "Z\"") != 2 {
		t.Fatal("wire timestamps did not use Z", string(raw), err)
	}
	snapshot.Telemetry.Fast.Errors = []string{"cpu_unavailable", "memory_unavailable"}
	summary = Summarize(snapshot)
	if summary.CPU != nil || summary.Memory != nil {
		t.Fatal("failed samples became numbers", summary)
	}
	summary = Summarize(Snapshot{})
	if summary.CPU != nil || summary.Memory != nil || !summary.ExpiresAt.IsZero() {
		t.Fatal(summary)
	}
}

func TestListSummaryDailyTrafficWithoutFastSample(t *testing.T) {
	now := time.Now().UTC()
	settings := v1.DefaultTelemetrySettings()
	settings.Traffic = &v1.TelemetryTrafficSettings{BillingMode: "outbound"}
	daily := &v1.TelemetryDailyTraffic{DayStart: now.Truncate(24 * time.Hour), DayEnd: now.Truncate(24 * time.Hour).Add(24 * time.Hour), SampledAt: now, RXBytes: "9007199254740993", TXBytes: "0", Revision: 1}
	summary := Summarize(Snapshot{Telemetry: &TelemetryLiveSnapshot{DailyTraffic: daily, Settings: &settings}})
	if summary.DailyTraffic != daily || summary.TrafficBillingMode != "outbound" || summary.TrafficExpiresAt == nil || !summary.TrafficExpiresAt.Equal(now.Add(time.Duration(settings.HttpReportSeconds+settings.CollectionSeconds+15)*time.Second)) || summary.CPU != nil {
		t.Fatalf("daily summary: %+v", summary)
	}
}
