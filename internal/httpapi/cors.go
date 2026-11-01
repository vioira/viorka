package httpapi

import (
	"net/http"
	"slices"
	"strings"
)

func (a *api) allowedOrigin(r *http.Request) bool {
	origins := r.Header.Values("Origin")
	if len(origins) != 1 || origins[0] == "" {
		return false
	}
	return origins[0] == a.Origin || slices.Contains(a.AllowedOrigins, origins[0])
}

// Browser origins share the same allowlist for CORS and mutation validation.
// Agent endpoints retain their separate bearer-token authentication contract.
func (a *api) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/v1/") || strings.HasPrefix(r.URL.Path, "/api/v1/agents/") {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Add("Vary", "Origin")
		if len(r.Header.Values("Origin")) == 0 {
			next.ServeHTTP(w, r)
			return
		}
		if !a.allowedOrigin(r) {
			fail(w, 403, "origin_rejected", "请求来源不受信任")
			return
		}
		w.Header().Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
			w.Header().Add("Vary", "Access-Control-Request-Method")
			w.Header().Add("Vary", "Access-Control-Request-Headers")
			method := r.Header.Get("Access-Control-Request-Method")
			if !slices.Contains([]string{"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"}, method) {
				fail(w, 403, "cors_rejected", "跨域请求方法不受支持")
				return
			}
			for _, line := range r.Header.Values("Access-Control-Request-Headers") {
				for _, header := range strings.Split(line, ",") {
					if !slices.Contains([]string{"content-type", "x-csrf-token", "last-event-id"}, strings.ToLower(strings.TrimSpace(header))) {
						fail(w, 403, "cors_rejected", "跨域请求头不受支持")
						return
					}
				}
			}
			w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, PATCH, DELETE")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token, Last-Event-ID")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
