package httpapi

import (
	"context"
	"net/http"

	"github.com/vioira/viorka/internal/agentupdate"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/scheduler"
	v1 "github.com/vioira/viorka/protocol/v1"
)

type updateRepository interface {
	AgentUpdateStatus(context.Context, string) (agentupdate.AgentUpdateStatus, error)
	SetAgentAutoUpdate(context.Context, string, string, bool) error
	QueueAgentUpdate(context.Context, string, string, v1.AgentUpdate) (scheduler.Task, error)
}
type AgentPolicyRequest struct {
	Auto *bool `json:"auto_update"`
}

func (a *api) registerAgentUpdates(routes routeRegistry) {
	repo, _ := a.Nodes.(updateRepository)
	path := "/api/v1/nodes/{id}/agent-update"
	wrap := func(role string, f func(http.ResponseWriter, *http.Request, auth.Session)) http.HandlerFunc {
		return a.user(role, func(w http.ResponseWriter, r *http.Request, s auth.Session) {
			if repo == nil {
				fail(w, 503, "unavailable", "Agent 更新服务暂不可用")
				return
			}
			if r.URL.RawQuery != "" {
				problem(w, auth.ErrInvalid)
				return
			}
			f(w, r, s)
		})
	}
	read := func(w http.ResponseWriter, r *http.Request, _ auth.Session) {
		status, err := repo.AgentUpdateStatus(r.Context(), r.PathValue("id"))
		if err != nil {
			problem(w, err)
			return
		}
		writeJSON(w, 200, status)
	}
	routes.handle("GET "+path, "getAgentUpdate", "viewer", 200, nil, agentupdate.AgentUpdateStatus{}, wrap("viewer", read))
	routes.handle("PUT "+path, "setAgentUpdatePolicy", "admin", 200, AgentPolicyRequest{}, agentupdate.AgentUpdateStatus{}, wrap("admin", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		var p AgentPolicyRequest
		if !decode(w, r, &p) {
			return
		}
		if p.Auto == nil {
			problem(w, auth.ErrInvalid)
			return
		}
		if err := repo.SetAgentAutoUpdate(r.Context(), s.User.ID, r.PathValue("id"), *p.Auto); err != nil {
			problem(w, err)
			return
		}
		read(w, r, s)
	}))
	routes.handle("POST "+path, "startAgentUpdate", "admin", 202, v1.AgentUpdate{}, TaskResponse{}, wrap("admin", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		var target v1.AgentUpdate
		if !decode(w, r, &target) {
			return
		}
		if !target.Valid() {
			problem(w, auth.ErrInvalid)
			return
		}
		task, err := repo.QueueAgentUpdate(r.Context(), s.User.ID, r.PathValue("id"), target)
		if err != nil {
			problem(w, err)
			return
		}
		writeJSON(w, 202, taskResponse(task))
	}))
}
