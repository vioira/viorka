package httpapi

import (
	"reflect"

	"github.com/vioira/viorka/internal/monitoring"
)

// projectMetricView exposes a fixed set of detail views, never arbitrary fields.
// Projection happens after cursor reads so a batching window retains every point.
func projectMetricView(value monitoring.LiveSnapshot, view string) monitoring.LiveSnapshot {
	if value.Telemetry == nil {
		return value
	}
	t := *value.Telemetry
	value.Telemetry = &t
	if view != "live" && view != "" {
		t.Points = []monitoring.TelemetryLivePoint{}
	}
	if view == "overview" || view == "settings" {
		t.PublicIP = nil
		if t.Fast != nil {
			f := *t.Fast
			t.Fast = &f
			f.Interfaces = []*monitoring.TelemetryInterfaceView{}
			f.SwapTotal, f.SwapUsed, f.UptimeSeconds, f.TcpInuse, f.UdpInuse = nil, nil, nil, nil, nil
			if view == "overview" {
				f.Traffic = nil
			} else {
				f.CPUPercent, f.RamTotal, f.RamUsed = nil, nil, nil
			}
		}
		if view == "settings" {
			t.Full = nil
		} else if t.Full != nil {
			f := *t.Full
			t.Full = &f
			f.Load1, f.Load5, f.Load15, f.Processes, f.DiskIo = nil, nil, nil, nil, nil
			f.OSID, f.OSName, f.OSVersion = "", "", ""
		}
	}
	return value
}

func metricDelta(value, previous monitoring.LiveSnapshot) monitoring.LiveSnapshot {
	if value.Reset || value.Telemetry == nil || previous.Telemetry == nil || value.Telemetry.RunID != previous.Telemetry.RunID {
		return value
	}
	t := *value.Telemetry
	value.Telemetry = &t
	old := previous.Telemetry
	if reflect.DeepEqual(t.Fast, old.Fast) {
		t.Fast = nil
	}
	if reflect.DeepEqual(t.Full, old.Full) {
		t.Full = nil
	}
	if reflect.DeepEqual(t.PublicIP, old.PublicIP) {
		t.PublicIP = nil
	}
	if reflect.DeepEqual(t.Settings, old.Settings) {
		t.Settings = nil
	}
	return value
}
