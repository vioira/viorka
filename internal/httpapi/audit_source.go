package httpapi

import (
	"net/http"

	"github.com/vioira/viorka/internal/audit"
)

func (a *api) auditSource(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := audit.WithSourceIP(r.Context(), a.requestIP(r))
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
