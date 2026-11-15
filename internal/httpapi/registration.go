package httpapi

import (
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/inventory"
	"net/http"
	"strconv"
)

type RegistrationTokensResponse struct {
	Items []auth.RegistrationToken `json:"items"`
}
type RegistrationRecordsResponse struct {
	Items []auth.RegistrationRecord `json:"items"`
}
type RenameNodeRequest struct {
	Name         string `json:"name" doc:"New name, 1–128 UTF-8 bytes after trimming; control characters forbidden"`
	ExpectedName string `json:"expected_name" doc:"Previously read name; stale changes return 409"`
}

func registrationPage(r *http.Request) (int, string, error) {
	limit := 50
	var err error
	if v := r.URL.Query().Get("limit"); v != "" {
		limit, err = strconv.Atoi(v)
	}
	after := r.URL.Query().Get("after")
	if err != nil || limit < 1 || limit > 100 || len(after) > 128 || len(r.PathValue("id")) > 128 {
		return 0, "", auth.ErrInvalid
	}
	return limit, after, nil
}
func (a *api) registerRegistration(routes routeRegistry) {
	routes.handle("POST /api/v1/node-registration-tokens", "createRegistrationToken", "admin", 201, auth.RegistrationOptions{}, auth.RegistrationSecret{}, a.user("admin", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		var v auth.RegistrationOptions
		if !decode(w, r, &v) {
			return
		}
		result, err := a.Agents.CreateRegistrationToken(r.Context(), s.User.ID, v)
		if err != nil {
			problem(w, err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, 201, result)
	}))
	routes.handle("GET /api/v1/node-registration-tokens", "listRegistrationTokens", "admin", 200, nil, RegistrationTokensResponse{}, a.user("admin", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		limit, after, err := registrationPage(r)
		if err != nil {
			problem(w, err)
			return
		}
		items, err := a.Agents.RegistrationTokens(r.Context(), limit, after)
		if err != nil {
			problem(w, err)
			return
		}
		writeJSON(w, 200, RegistrationTokensResponse{Items: items})
	}))
	routes.handle("DELETE /api/v1/node-registration-tokens/{id}", "revokeRegistrationToken", "admin", 204, nil, nil, a.user("admin", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		if _, _, err := registrationPage(r); err != nil {
			problem(w, err)
			return
		}
		if err := a.Agents.RevokeRegistrationToken(r.Context(), s.User.ID, r.PathValue("id")); err != nil {
			problem(w, err)
			return
		}
		w.WriteHeader(204)
	}))
	routes.handle("GET /api/v1/node-registration-tokens/{id}/nodes", "listRegistrationRecords", "admin", 200, nil, RegistrationRecordsResponse{}, a.user("admin", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		limit, after, err := registrationPage(r)
		if err != nil {
			problem(w, err)
			return
		}
		items, err := a.Agents.RegistrationRecords(r.Context(), r.PathValue("id"), limit, after)
		if err != nil {
			problem(w, err)
			return
		}
		writeJSON(w, 200, RegistrationRecordsResponse{Items: items})
	}))
	routes.handle("POST /api/v1/agents/register", "registerAgent", "", 201, auth.RegisterRequest{}, EnrollResponse{}, func(w http.ResponseWriter, r *http.Request) {
		if !a.allow(w) {
			return
		}
		var v auth.RegisterRequest
		if !decode(w, r, &v) {
			return
		}
		id, err := a.Agents.Register(r.Context(), v)
		if err != nil {
			problem(w, err)
			return
		}
		writeJSON(w, 201, EnrollResponse{NodeID: id, ProtocolVersion: "1.0"})
	})
	routes.handle("PATCH /api/v1/nodes/{id}", "renameNode", "admin", 204, RenameNodeRequest{}, nil, a.user("admin", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		var v RenameNodeRequest
		if !decode(w, r, &v) {
			return
		}
		if err := inventory.Rename(r.Context(), a.Nodes, s.User.ID, r.PathValue("id"), v.Name, v.ExpectedName); err != nil {
			problem(w, err)
			return
		}
		w.WriteHeader(204)
	}))
}
