package httpapi

import (
	"github.com/vioira/viorka/internal/auth"
	"net/http"
	"strconv"
)

func (a *api) node(w http.ResponseWriter, r *http.Request, s auth.Session) {
	id := r.PathValue("id")
	if len(id) > 128 {
		problem(w, auth.ErrInvalid)
		return
	}
	n, err := a.Nodes.Node(r.Context(), id)
	if err != nil {
		problem(w, err)
		return
	}
	snapshot := a.Gateway.Metrics(n.ID, false)
	if n.State != "online" {
		snapshot.Stale = true
	}
	n.Monitoring = &snapshot
	writeJSON(w, http.StatusOK, n)
}

func (a *api) nodeTasks(w http.ResponseWriter, r *http.Request, s auth.Session) {
	limit := 50
	var err error
	if value := r.URL.Query().Get("limit"); value != "" {
		limit, err = strconv.Atoi(value)
	}
	if err != nil || limit < 1 || limit > 100 || len(r.URL.Query().Get("after")) > 128 || len(r.PathValue("id")) > 128 {
		problem(w, auth.ErrInvalid)
		return
	}
	if _, err := a.Nodes.Node(r.Context(), r.PathValue("id")); err != nil {
		problem(w, err)
		return
	}
	items, err := a.Tasks.List(r.Context(), r.PathValue("id"), limit, r.URL.Query().Get("after"))
	if err != nil {
		problem(w, err)
		return
	}
	writeJSON(w, http.StatusOK, NodeTasksResponse{Items: items})
}
