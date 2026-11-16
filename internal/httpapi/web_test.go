package httpapi

import (
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestWebRoutes(t *testing.T) {
	h := NewRouter(Dependencies{Web: fstest.MapFS{
		"index.html":    {Data: []byte("<!doctype html><title>Viorka</title>")},
		"assets/app.js": {Data: []byte("console.log('viorka')")},
		".env":          {Data: []byte("secret")},
	}})
	for _, tc := range []struct {
		method, path string
		status       int
		body         string
	}{
		{"GET", "/", 200, "<title>Viorka</title>"},
		{"GET", "/nodes/node-1?tab=services", 200, "<title>Viorka</title>"},
		{"HEAD", "/nodes/node-1", 200, ""},
		{"GET", "/assets/app.js", 200, "console.log"},
		{"GET", "/assets/missing.js", 404, "404"},
		{"GET", "/assets/", 404, "404"},
		{"GET", "/.env", 404, "404"},
		{"POST", "/login", 405, "Method Not Allowed"},
		{"GET", "/api/v1/version", 200, `"product":"Viorka"`},
		{"GET", "/api/v1/unknown", 401, `"code":"unauthorized"`},
		{"GET", "/healthz", 200, `"status":"ok"`},
	} {
		t.Run(tc.method+tc.path, func(t *testing.T) {
			w := httptest.NewRecorder()
			h.ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, nil))
			if w.Code != tc.status || !strings.Contains(w.Body.String(), tc.body) {
				t.Fatalf("response: %d %s", w.Code, w.Body.String())
			}
			if tc.method == "HEAD" && w.Body.Len() != 0 {
				t.Fatal("HEAD returned a body")
			}
			if strings.HasSuffix(tc.path, ".js") && tc.status == 200 && !strings.Contains(w.Header().Get("Content-Type"), "javascript") {
				t.Fatal("incorrect JavaScript MIME type")
			}
		})
	}
}

func TestWebMissingBuild(t *testing.T) {
	h := NewRouter(Dependencies{Web: fstest.MapFS{}})
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/", nil))
	if w.Code != 503 {
		t.Fatalf("status = %d", w.Code)
	}
}
