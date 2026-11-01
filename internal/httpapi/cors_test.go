package httpapi

import (
	"github.com/vioira/viorka/internal/auth"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCORSOrigins(t *testing.T) {
	a := &api{Dependencies: Dependencies{Origin: "https://panel.example.com", AllowedOrigins: []string{"https://console.example.com", "http://localhost:5173"}}}
	for _, tc := range []struct {
		origin, method, headers string
		status                  int
	}{
		{"https://panel.example.com", "POST", "Content-Type,X-CSRF-Token", 204},
		{"https://console.example.com", "PUT", "content-type,x-csrf-token", 204},
		{"http://localhost:5173", "GET", "Last-Event-ID", 204},
		{"https://evil.example.com", "GET", "", 403},
		{"https://console.example.com.evil.test", "GET", "", 403},
		{"null", "GET", "", 403},
		{"https://console.example.com", "TRACE", "", 403},
		{"https://console.example.com", "POST", "Authorization", 403},
	} {
		t.Run(tc.origin+tc.method+tc.headers, func(t *testing.T) {
			called := false
			h := a.cors(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true }))
			r := httptest.NewRequest("OPTIONS", "/api/v1/auth/login", nil)
			r.Header.Set("Origin", tc.origin)
			r.Header.Set("Access-Control-Request-Method", tc.method)
			if tc.headers != "" {
				r.Header.Set("Access-Control-Request-Headers", tc.headers)
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != tc.status || called {
				t.Fatalf("status=%d called=%v", w.Code, called)
			}
			if tc.status == 204 && (w.Header().Get("Access-Control-Allow-Origin") != tc.origin || w.Header().Get("Access-Control-Allow-Credentials") != "true") {
				t.Fatal(w.Header())
			}
		})
	}
}

func TestAdditionalOriginAuthentication(t *testing.T) {
	f := setup(t, "admin")
	h := NewRouter(Dependencies{Origin: f.server.URL, AllowedOrigins: []string{"https://console.example.com"}, Auth: f.users, Agents: f.agents, Gateway: f.gate, Nodes: f.store})
	for _, tc := range []struct {
		origin, csrf string
		cookie       bool
		status       int
	}{
		{"https://console.example.com", f.session.CSRF, true, 204},
		{f.server.URL, f.session.CSRF, true, 204},
		{"https://console.example.com", "wrong", true, 403},
		{"https://evil.test", f.session.CSRF, true, 403},
		{"", f.session.CSRF, true, 403},
		{"https://console.example.com", f.session.CSRF, false, 401},
	} {
		// Exercise the real session/CSRF middleware without revoking the shared session.
		a := &api{Dependencies: Dependencies{Origin: f.server.URL, AllowedOrigins: []string{"https://console.example.com"}, Auth: f.users}}
		r := httptest.NewRequest("POST", "/api/v1/test", nil)
		r.Header.Set("Origin", tc.origin)
		r.Header.Set("X-CSRF-Token", tc.csrf)
		if tc.cookie {
			r.AddCookie(f.cookie)
		}
		w := httptest.NewRecorder()
		a.user("viewer", func(w http.ResponseWriter, r *http.Request, _ auth.Session) { w.WriteHeader(204) })(w, r)
		if w.Code != tc.status {
			t.Fatalf("%+v: %d", tc, w.Code)
		}
	}
	r := httptest.NewRequest("POST", "/api/v1/auth/login", strings.NewReader(`{"username":"admin","password":"test-password-123"}`))
	r.Header.Set("Origin", "https://console.example.com")
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 || w.Header().Get("Access-Control-Allow-Origin") != "https://console.example.com" {
		t.Fatalf("login: %d %s", w.Code, w.Body)
	}
	r = httptest.NewRequest("GET", "/api/v1/agents/ws", nil)
	r.Header.Set("Origin", "https://console.example.com")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 403 || w.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("browser Agent request accepted")
	}
	r = httptest.NewRequest("GET", "/api/v1/auth/session", nil)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 401 || !strings.Contains(w.Header().Get("Vary"), "Origin") {
		t.Fatal("missing authentication or cache variation")
	}
}
