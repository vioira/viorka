package httpapi

import (
	"errors"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/inventory"
	"github.com/vioira/viorka/internal/monitoring"
	"net/http"
	"strconv"
)

func (a *api) deleteNode(w http.ResponseWriter, r *http.Request, s auth.Session) {
	id := r.PathValue("id")
	if len(id) > 128 {
		problem(w, auth.ErrInvalid)
		return
	}
	err := a.Nodes.DeleteNode(r.Context(), s.User.ID, id)
	switch {
	case errors.Is(err, inventory.ErrNodeBusy):
		fail(w, 409, "node_tasks_active", "节点有未完成任务，请等待任务结束或取消任务后再删除")
		return
	case errors.Is(err, inventory.ErrNodeReferenced):
		fail(w, 409, "node_in_use", "节点仍有第三方引擎、独立代理服务、中转规则或其他配置依赖，请先处理")
		return
	case err != nil:
		problem(w, err)
		return
	}
	a.Gateway.Revoke(id)
	a.Gateway.ForgetMetrics(id)
	w.WriteHeader(http.StatusNoContent)
}

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
	value, err := a.Gateway.ReadMetrics(n.ID, monitoring.Cursor{}, false)
	if err != nil {
		problem(w, err)
		return
	}
	snapshot := value.Snapshot
	snapshot.ManagementOnline = n.State == "online"
	if n.State != "online" && snapshot.Telemetry == nil {
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
	writeJSON(w, http.StatusOK, NodeTasksResponse{Items: taskResponses(items)})
}
