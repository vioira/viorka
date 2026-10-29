package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestImplementedRoutes(t *testing.T) {
	cases := []struct{ path, expected string }{
		{"/healthz", `"status":"ok"`},
		{"/readyz", `"scope":"http-only"`},
		{"/api/v1/version", `"stage":"scaffold"`},
	}
	for _, tc := range cases {
		t.Run(tc.path, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, tc.path, nil)
			w := httptest.NewRecorder()
			NewRouter().ServeHTTP(w, r)
			if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), tc.expected) {
				t.Fatalf("response status=%d body=%q", w.Code, w.Body.String())
			}
		})
	}
}
