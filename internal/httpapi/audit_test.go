package httpapi

import (
	"strings"
	"testing"
)

func TestAuditAPI(t *testing.T) {
	f := setup(t, "admin")
	expectStatus(t, f.request("GET", "/api/v1/audit-logs", nil, false), 401)
	empty := decodeResponse[AuditLogsResponse](t, f.request("GET", "/api/v1/audit-logs", nil, true), 200)
	if empty.Items == nil || len(empty.Items) != 0 || empty.NextCursor != "" {
		t.Fatalf("empty: %+v", empty)
	}
	f.enroll()
	f.enroll()
	first := decodeResponse[AuditLogsResponse](t, f.request("GET", "/api/v1/audit-logs?limit=1&kind=user", nil, true), 200)
	if len(first.Items) != 1 || first.NextCursor == "" || first.Items[0].Actor != "admin" || first.Items[0].Action != "node.create" {
		t.Fatalf("first: %+v", first)
	}
	second := decodeResponse[AuditLogsResponse](t, f.request("GET", "/api/v1/audit-logs?limit=1&after="+first.NextCursor, nil, true), 200)
	if len(second.Items) != 1 || second.NextCursor != "" || second.Items[0].ID == first.Items[0].ID {
		t.Fatalf("second: %+v", second)
	}
	for _, query := range []string{"limit=0", "limit=101", "limit=no", "kind=invalid", "after=missing", "after=" + strings.Repeat("a", 129), "limit=1&limit=2", "sort=action"} {
		expectStatus(t, f.request("GET", "/api/v1/audit-logs?"+query, nil, true), 400)
	}
	system := decodeResponse[AuditLogsResponse](t, f.request("GET", "/api/v1/audit-logs?kind=system", nil, true), 200)
	if len(system.Items) != 0 {
		t.Fatal("user records leaked into system filter")
	}
	f.store.Close()
	expectStatus(t, f.request("GET", "/api/v1/audit-logs", nil, true), 503)
}
func TestAuditPermissions(t *testing.T) {
	for _, role := range []string{"viewer", "operator"} {
		t.Run(role, func(t *testing.T) {
			f := setup(t, role)
			expectStatus(t, f.request("GET", "/api/v1/audit-logs", nil, true), 403)
		})
	}
}
