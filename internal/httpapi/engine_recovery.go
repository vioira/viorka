package httpapi

import (
	"context"
	"net/http"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/proxy"
	"github.com/vioira/viorka/internal/scheduler"
)

type managedRecoveryRequest struct {
	Name           string `json:"name"`
	IdempotencyKey string `json:"idempotency_key"`
}
type managedRecoveryConfirmation struct {
	Confirm bool `json:"confirm"`
}
type managedRecoveryResponse struct {
	EngineID string `json:"engine_id"`
}

type managedRecoveryRepository interface {
	StartManagedRecovery(context.Context, string, string, string, string) (scheduler.Task, error)
	PreviewManagedRecovery(context.Context, string, string, string) (proxy.ManagedRecoveryPreview, error)
	ConfirmManagedRecovery(context.Context, string, string, string) (string, error)
}

func (a *api) registerManagedEngineRecovery(routes routeRegistry) {
	repository := func(w http.ResponseWriter) (managedRecoveryRepository, bool) {
		r, ok := a.Nodes.(managedRecoveryRepository)
		if !ok {
			problem(w, proxy.ErrUnavailable)
		}
		return r, ok
	}
	routes.handle("POST /api/v1/nodes/{id}/engine-recovery", "startManagedEngineRecovery", "admin", 202, managedRecoveryRequest{}, TaskResponse{}, a.user("admin", func(w http.ResponseWriter, r *http.Request, session auth.Session) {
		var request managedRecoveryRequest
		if !decode(w, r, &request) {
			return
		}
		repo, ok := repository(w)
		if !ok {
			return
		}
		task, err := repo.StartManagedRecovery(r.Context(), session.User.ID, r.PathValue("id"), request.Name, request.IdempotencyKey)
		if err != nil {
			problem(w, err)
			return
		}
		writeJSON(w, 202, taskResponse(task))
	}))
	routes.handle("GET /api/v1/nodes/{id}/engine-recovery/{task}", "previewManagedEngineRecovery", "admin", 200, nil, proxy.ManagedRecoveryPreview{}, a.user("admin", func(w http.ResponseWriter, r *http.Request, session auth.Session) {
		repo, ok := repository(w)
		if !ok {
			return
		}
		view, err := repo.PreviewManagedRecovery(r.Context(), session.User.ID, r.PathValue("id"), r.PathValue("task"))
		if err != nil {
			problem(w, err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, 200, view)
	}))
	routes.handle("POST /api/v1/nodes/{id}/engine-recovery/{task}", "confirmManagedEngineRecovery", "admin", 200, managedRecoveryConfirmation{}, managedRecoveryResponse{}, a.user("admin", func(w http.ResponseWriter, r *http.Request, session auth.Session) {
		var confirmation managedRecoveryConfirmation
		if !decode(w, r, &confirmation) {
			return
		}
		if !confirmation.Confirm {
			problem(w, proxy.ErrInvalid)
			return
		}
		repo, ok := repository(w)
		if !ok {
			return
		}
		id, err := repo.ConfirmManagedRecovery(r.Context(), session.User.ID, r.PathValue("id"), r.PathValue("task"))
		if err != nil {
			problem(w, err)
			return
		}
		writeJSON(w, 200, managedRecoveryResponse{EngineID: id})
	}))
}
