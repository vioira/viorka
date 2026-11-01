package httpapi

import (
	"net/http"
	"strconv"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/scheduler"
)

func (a *api) registerTaskCenter(routes routeRegistry) {
	routes.handle("GET /api/v1/tasks", "listTasks", "viewer", 200, nil, scheduler.Page{}, a.user("viewer", func(w http.ResponseWriter, r *http.Request, _ auth.Session) {
		q := r.URL.Query()
		for key, values := range q {
			if (key != "limit" && key != "after" && key != "state") || len(values) != 1 {
				problem(w, auth.ErrInvalid)
				return
			}
		}
		limit := 50
		var err error
		if q.Has("limit") {
			limit, err = strconv.Atoi(q.Get("limit"))
		}
		if err != nil {
			problem(w, auth.ErrInvalid)
			return
		}
		state := q.Get("state")
		if state == "" {
			state = "all"
		}
		result, err := a.Tasks.Page(r.Context(), limit, q.Get("after"), state)
		if err != nil {
			problem(w, err)
			return
		}
		writeJSON(w, 200, result)
	}))
	routes.handle("GET /api/v1/tasks/summary", "taskSummary", "viewer", 200, nil, scheduler.Summary{}, a.user("viewer", func(w http.ResponseWriter, r *http.Request, _ auth.Session) {
		if len(r.URL.Query()) != 0 {
			problem(w, auth.ErrInvalid)
			return
		}
		result, err := a.Tasks.Summary(r.Context())
		if err != nil {
			problem(w, err)
			return
		}
		writeJSON(w, 200, result)
	}))
}
