package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
)

func TestAuditRequestSource(t *testing.T) {
	for _, tc := range []struct {
		name, remote string
		forwarded    []string
		trust        bool
		want         string
	}{
		{"direct", "192.0.2.10:1234", nil, false, "192.0.2.10"},
		{"spoofed header", "192.0.2.10:1234", []string{"203.0.113.9"}, false, "192.0.2.10"},
		{"trusted chain", "127.0.0.1:1234", []string{"203.0.113.9, 10.0.0.1"}, true, "203.0.113.9"},
		{"first untrusted hop", "127.0.0.1:1234", []string{"203.0.113.9, 192.0.2.10"}, true, "192.0.2.10"},
		{"invalid header", "127.0.0.1:1234", []string{"invalid"}, true, "127.0.0.1"},
		{"duplicate header", "127.0.0.1:1234", []string{"203.0.113.9", "192.0.2.10"}, true, "127.0.0.1"},
		{"ipv6", "[2001:db8::1]:1234", nil, false, "2001:db8::1"},
		{"invalid peer", "invalid", []string{"203.0.113.9"}, true, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := setup(t, "admin")
			deps := Dependencies{Auth: f.users, Agents: f.agents, Audit: f.store, Origin: f.server.URL}
			if tc.trust {
				deps.TrustedProxies = []netip.Prefix{netip.MustParsePrefix("127.0.0.1/32"), netip.MustParsePrefix("10.0.0.0/8")}
			}
			handler := NewRouter(deps)
			for _, operation := range []struct {
				path, body, action string
				status             int
			}{
				{"/api/v1/auth/login", `{"username":"admin","password":"test-password-123"}`, "session.login", 200},
				{"/api/v1/nodes", `{"name":"audit source","kind":"nat"}`, "node.create", 201},
			} {
				r := httptest.NewRequest(http.MethodPost, f.server.URL+operation.path, strings.NewReader(operation.body))
				r.RemoteAddr = tc.remote
				r.Header.Set("Content-Type", "application/json")
				r.Header.Set("Origin", f.server.URL)
				r.Header.Set("X-CSRF-Token", f.session.CSRF)
				for _, value := range tc.forwarded {
					r.Header.Add("X-Forwarded-For", value)
				}
				r.AddCookie(f.cookie)
				w := httptest.NewRecorder()
				handler.ServeHTTP(w, r)
				if w.Code != operation.status {
					t.Fatalf("%s: %d %s", operation.path, w.Code, w.Body.String())
				}
				rows, err := f.store.AuditLogs(context.Background(), 100, "", "all")
				if err != nil {
					t.Fatal(err)
				}
				found := false
				for _, row := range rows {
					if row.Action == operation.action {
						if row.SourceIP != tc.want {
							t.Fatalf("%s source = %q, want %q", operation.action, row.SourceIP, tc.want)
						}
						found = true
						break
					}
				}
				if !found {
					t.Fatalf("missing %s audit", operation.action)
				}
			}
		})
	}
}
