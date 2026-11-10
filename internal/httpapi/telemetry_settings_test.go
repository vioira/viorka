package httpapi

import (
	"context"
	"encoding/json"
	"testing"

	v1 "github.com/vioira/viorka/protocol/v1"
)

func TestTelemetrySettingsREST(t *testing.T) {
	f := setup(t, "admin")
	node, _ := f.enroll()
	other, _ := f.enroll()
	path := "/api/v1/nodes/" + node + "/telemetry-settings"
	combined := decodeResponse[TelemetrySettingsResponse](t, f.request("GET", path, nil, true), 200)
	if combined.Status.State != "pending" {
		t.Fatal(combined)
	}
	defaults := combined.TelemetrySettings
	if defaults != v1.DefaultTelemetrySettings() {
		t.Fatal(defaults)
	}
	initial := decodeResponse[TelemetrySettingsStatus](t, f.request("GET", path+"/status", nil, true), 200)
	if initial.State != "pending" || initial.Result != nil {
		t.Fatal(initial)
	}
	next := defaults
	next.LogLevel = "debug"
	next.CollectionSeconds = 60
	next.HttpReportSeconds = 30
	saved := decodeResponse[v1.TelemetrySettings](t, f.request("PUT", path, next, true), 200)
	if saved.LogLevel != "debug" || saved.Revision != 2 || saved.CollectionSeconds != 60 || saved.HttpReportSeconds != 30 {
		t.Fatal(saved)
	}
	expectStatus(t, f.request("PUT", path, next, true), 409)
	for _, change := range []func(*v1.TelemetrySettings){
		func(s *v1.TelemetrySettings) { s.LogLevel = "trace" }, func(s *v1.TelemetrySettings) { s.CollectionSeconds = 0 }, func(s *v1.TelemetrySettings) { s.CollectionSeconds = 61 }, func(s *v1.TelemetrySettings) { s.HttpReportSeconds = 29 }, func(s *v1.TelemetrySettings) { s.HttpReportSeconds = 181 }, func(s *v1.TelemetrySettings) { s.WssReportSeconds = 0 }, func(s *v1.TelemetrySettings) { s.WssReportSeconds = 6 }, func(s *v1.TelemetrySettings) { s.ConnectionMode = "wss" },
	} {
		bad := saved
		change(&bad)
		expectStatus(t, f.request("PUT", path, bad, true), 400)
	}
	expectStatus(t, f.request("PUT", path, map[string]any{"revision": 2, "collection_seconds": nil, "http_report_seconds": 30, "wss_report_seconds": 2, "connection_mode": "auto_http_wss"}, true), 400)
	expectStatus(t, f.request("PUT", path, map[string]any{"revision": 2, "collection_seconds": 1, "http_report_seconds": 30, "wss_report_seconds": 2, "connection_mode": "auto_http_wss", "extra": true}, true), 400)
	expectStatus(t, f.request("PUT", path, json.RawMessage(`{"revision":2,"collection_seconds":1,"collection_seconds":60,"http_report_seconds":30,"wss_report_seconds":2,"connection_mode":"auto_http_wss"}`), true), 400)
	expectStatus(t, f.request("PUT", path, json.RawMessage(`{"revision":2,"collection_seconds":1,"http_report_seconds":30,"connection_mode":"auto_http_wss"}`), true), 400)
	expectStatus(t, f.request("PUT", path, json.RawMessage(`{"revision":2,"collection_seconds":1.5,"http_report_seconds":30,"wss_report_seconds":2,"connection_mode":"auto_http_wss"}`), true), 400)
	if current := decodeResponse[v1.TelemetrySettings](t, f.request("GET", path, nil, true), 200); current != saved {
		t.Fatal("invalid settings changed persisted value or revision", current)
	}
	expectStatus(t, f.request("GET", path+"?x=1", nil, true), 400)
	expectStatus(t, f.request("PUT", path, saved, false), 401)
	expectStatus(t, f.request("GET", path, nil, false), 401)
	expectStatus(t, f.request("GET", "/api/v1/nodes/missing/telemetry-settings", nil, true), 404)
	expectStatus(t, f.request("GET", "/api/v1/nodes/missing/telemetry-settings/status", nil, true), 404)
	expectStatus(t, f.request("PUT", "/api/v1/nodes/missing/telemetry-settings", defaults, true), 404)
	unchanged := decodeResponse[v1.TelemetrySettings](t, f.request("GET", "/api/v1/nodes/"+other+"/telemetry-settings", nil, true), 200)
	if unchanged != defaults {
		t.Fatal("other node changed")
	}
	result := v1.TelemetrySettingsResult{Revision: 2, AppliedRevision: 2, State: "applied"}
	if err := f.store.RecordTelemetrySettingsResult(context.Background(), node, result); err != nil {
		t.Fatal(err)
	}
	status := decodeResponse[TelemetrySettingsStatus](t, f.request("GET", path+"/status", nil, true), 200)
	if status.State != "applied" || status.Result == nil || *status.Result != result {
		t.Fatal(status)
	}
	decodeResponse[v1.TelemetrySettings](t, f.request("PUT", path, saved, true), 200)
	status = decodeResponse[TelemetrySettingsStatus](t, f.request("GET", path+"/status", nil, true), 200)
	if status.State != "pending" || status.Result != nil {
		t.Fatal(status)
	}
}
func TestTelemetrySettingsViewerReadOnly(t *testing.T) {
	f := setup(t, "viewer")
	expectStatus(t, f.request("PUT", "/api/v1/nodes/any/telemetry-settings", v1.DefaultTelemetrySettings(), true), 403)
	expectStatus(t, f.request("GET", "/api/v1/nodes/missing/telemetry-settings", nil, true), 404)
}
