package httpapi

import (
	"testing"

	"github.com/vioira/viorka/internal/inventory"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func TestAggregateNodeSettings(t *testing.T) {
	f := setup(t, "admin")
	node, _ := f.enroll()
	path := "/api/v1/nodes/" + node + "/settings"
	save := func(body map[string]any) inventory.NodeSettingsResult {
		t.Helper()
		return decodeResponse[inventory.NodeSettingsResult](t, f.request("PATCH", path, body, true), 200)
	}
	telemetry := v1.DefaultTelemetrySettings()
	billing := map[string]any{"expected_revision": 1, "price": "12", "currency": "EUR", "period_months": 3}
	first := save(map[string]any{"billing": billing})
	if first.Telemetry != nil || first.Billing == nil || first.Billing.Revision != 2 {
		t.Fatal(first)
	}
	next := save(map[string]any{"telemetry": telemetry})
	if next.Billing != nil || next.Telemetry == nil || next.Telemetry.Revision != 2 {
		t.Fatal(next)
	}
	billing["expected_revision"] = 2
	billing["price"] = "23"
	both := map[string]any{"billing": billing, "telemetry": telemetry}
	expectStatus(t, f.request("PATCH", path, both, true), 409)
	n, err := f.store.Node(t.Context(), node)
	if err != nil || n.Billing.Revision != 2 || n.Billing.Price == nil || *n.Billing.Price != "12" {
		t.Fatalf("billing changed after rollback: %+v %v", n.Billing, err)
	}
	both["telemetry"] = next.Telemetry
	result := save(both)
	if result.Billing == nil || result.Billing.Revision != 3 || *result.Billing.Price != "23" || result.Telemetry == nil || result.Telemetry.Revision != 3 {
		t.Fatal(result)
	}
	for _, bad := range []map[string]any{{}, {"unknown": 1}, {"telemetry": map[string]any{"revision": 3}}, {"billing": map[string]any{"price": "1"}}} {
		expectStatus(t, f.request("PATCH", path, bad, true), 400)
	}
	expectStatus(t, f.request("PATCH", path, both, false), 401)
	for _, role := range []string{"viewer", "operator"} {
		g := setup(t, role)
		expectStatus(t, g.request("PATCH", path, both, true), 403)
	}
	expectStatus(t, f.request("PATCH", "/api/v1/nodes/missing/settings", both, true), 404)
}

func TestNodeExpiryDate(t *testing.T) {
	f := setup(t, "admin")
	node, _ := f.enroll()
	path := "/api/v1/nodes/" + node + "/settings"
	patch := func(b map[string]any) inventory.Billing {
		t.Helper()
		saved := decodeResponse[inventory.NodeSettingsResult](t, f.request("PATCH", path, map[string]any{"billing": b}, true), 200)
		return *saved.Billing
	}
	revision := 1
	for _, tc := range []struct{ date, zone, utc string }{
		{"2028-02-29", "Asia/Shanghai", "2028-02-29T15:59:59Z"},
		{"2026-03-08", "America/New_York", "2026-03-09T03:59:59Z"},
		{"2026-11-01", "America/New_York", "2026-11-02T04:59:59Z"},
	} {
		b := patch(map[string]any{"expected_revision": revision, "expires_on": tc.date, "time_zone": tc.zone})
		if b.ExpiresAt == nil || *b.ExpiresAt != tc.utc {
			t.Fatalf("%s %s: %+v", tc.date, tc.zone, b)
		}
		revision++
	}
	for _, bad := range []map[string]any{{"expires_on": "2026-02-30", "time_zone": "UTC"}, {"expires_on": "2026-11-01"}, {"time_zone": "UTC"}, {"expires_on": "2026-11-01", "time_zone": "unknown"}, {"expires_on": "2026-11-01", "time_zone": "UTC", "keep_expiry": true}} {
		bad["expected_revision"] = revision
		expectStatus(t, f.request("PATCH", path, map[string]any{"billing": bad}, true), 400)
	}
	b := patch(map[string]any{"expected_revision": revision, "keep_expiry": true, "price": "5", "currency": "USD", "period_months": 1})
	if b.ExpiresAt == nil || *b.ExpiresAt != "2026-11-02T04:59:59Z" {
		t.Fatal(b)
	}
	b = patch(map[string]any{"expected_revision": b.Revision})
	if b.ExpiresAt != nil {
		t.Fatal(b)
	}
}

func TestNodeDomainSettings(t *testing.T) {
	f := setup(t, "admin")
	node, _ := f.enroll()
	path := "/api/v1/nodes/" + node
	patch := func(domain, expected string) map[string]any {
		return map[string]any{"domain": domain, "expected_domain": expected}
	}
	for _, bad := range []map[string]any{patch("https://example.org", ""), patch("127.0.0.1", ""), patch("example.org:443", ""), patch("a..org", ""), patch("-bad.example", ""), {"domain": ""}, {"expected_domain": ""}} {
		expectStatus(t, f.request("PATCH", path+"/settings", bad, true), 400)
	}
	update := patch("EDGE.Example.org.", "")
	saved := decodeResponse[inventory.NodeSettingsResult](t, f.request("PATCH", path+"/settings", update, true), 200)
	if saved.Domain == nil || *saved.Domain != "edge.example.org" || saved.Telemetry != nil {
		t.Fatal(saved)
	}
	expectStatus(t, f.request("PATCH", path+"/settings", update, true), 200)
	expectStatus(t, f.request("PATCH", path+"/settings", patch("stale.example", ""), true), 409)
	combined := patch("new.example", "edge.example.org")
	combined["billing"] = map[string]any{"expected_revision": 22}
	expectStatus(t, f.request("PATCH", path+"/settings", combined, true), 409)
	read := decodeResponse[inventory.Node](t, f.request("GET", path, nil, true), 200)
	if read.Domain != "edge.example.org" {
		t.Fatal(read.Domain)
	}
	cleared := decodeResponse[inventory.NodeSettingsResult](t, f.request("PATCH", path+"/settings", patch("", "edge.example.org"), true), 200)
	if cleared.Domain == nil || *cleared.Domain != "" {
		t.Fatal(cleared)
	}
	read = decodeResponse[inventory.Node](t, f.request("GET", path, nil, true), 200)
	if read.Domain != "" {
		t.Fatal(read.Domain)
	}
}
