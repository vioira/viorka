package httpapi

import (
	"context"

	"net/http"
	"net/url"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/inventory"
	"github.com/vioira/viorka/internal/monitoring"
	"github.com/vioira/viorka/internal/realtime"
)

type MetricFrame struct {
	Reset      bool                               `json:"reset"`
	Items      map[string]monitoring.LiveSnapshot `json:"items"`
	RemovedIDs []string                           `json:"removed_ids"`
}

func (a *api) registerMetricEvents(routes routeRegistry) {
	routes.handle("GET /api/v1/metrics/events", "metricEvents", "viewer", 200, nil, MetricFrame{}, a.user("viewer", a.metricEvents))
}

func (a *api) metricEvents(w http.ResponseWriter, r *http.Request, session auth.Session) {
	q, err := parseMetricScope(r)
	if err != nil {
		problem(w, err)
		return
	}
	done, ok := a.startStream(w, r)
	if !ok {
		return
	}
	defer done()
	// Subscribe before reading the snapshot. Changes during the read stay queued.
	sub := a.Events.Subscribe(func(c realtime.Change) bool {
		return (c.Kind == "access" && (c.UserID == "" || c.UserID == session.User.ID)) || c.Kind == "settings" || ((c.Kind == "metrics" || c.Kind == "node" || c.Kind == "nodes") && (c.NodeID == q.node || (q.node == "" && c.NodeID <= q.through)))
	})
	defer sub.Close()
	nodes, err := a.metricNodes(r.Context(), q)
	if err != nil {
		problem(w, err)
		return
	}
	cursors := map[string]monitoring.Cursor{}
	states := map[string]string{}
	for _, node := range nodes {
		states[node.ID] = node.State
	}
	send := func(ids map[string]bool, reset bool, removed []string) bool {
		frame := MetricFrame{Reset: reset, Items: map[string]monitoring.LiveSnapshot{}, RemovedIDs: removed}
		for id := range ids {
			after := cursors[id]
			if reset {
				after = monitoring.Cursor{}
			}
			value, err := a.Gateway.ReadMetrics(id, after, q.node == "")
			if err != nil {
				return false
			}
			value.ManagementOnline = states[id] == "online"
			if states[id] != "online" && value.Telemetry == nil {
				value.Stale = true
			}
			if q.node == "" {
				// List rows currently show CPU and memory; omit all device arrays.
				value.Points = []monitoring.LivePoint{}
			}
			cursors[id] = monitoring.Cursor{Sequence: value.Sequence, Generation: value.Generation}
			frame.Items[id] = value
		}
		return streamJSON(w, "metrics", frame)
	}
	ids := map[string]bool{}
	for id := range states {
		ids[id] = true
	}
	if !a.streamAccess(r) {
		return
	}
	scopeIDs := func() []string {
		out := make([]string, 0, len(states))
		for id := range states {
			out = append(out, id)
		}
		return out
	}
	demand, err := a.Gateway.SubscribeTelemetry(scopeIDs())
	if err != nil {
		problem(w, err)
		return
	}
	defer func() { demand.Close(time.Now()) }()
	if !send(ids, true, []string{}) {
		return
	}
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-a.Shutdown.Done():
			return
		case <-heartbeat.C:
			if !a.streamAccess(r) {
				streamJSON(w, "closed", struct{}{})
				return
			}
			if !streamFrame(w, ": heartbeat\n\n") {
				return
			}
		case <-sub.Wake:
			// One-shot batching, armed by actual changes. No cache or DB polling.
			timer := time.NewTimer(100 * time.Millisecond)
			select {
			case <-timer.C:
			case <-r.Context().Done():
				timer.Stop()
				return
			case <-a.Shutdown.Done():
				timer.Stop()
				return
			}
			if !a.streamAccess(r) {
				streamJSON(w, "closed", struct{}{})
				return
			}
			changes, reset := sub.Drain()
			ids := map[string]bool{}
			removed := []string{}
			for _, c := range changes {
				if c.Kind == "nodes" {
					reset = true
				}
				if c.Kind == "node" {
					ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
					node, err := a.Nodes.Node(ctx, c.NodeID)
					cancel()
					if err == nil {
						states[c.NodeID] = node.State
					} else if err == auth.ErrNotFound {
						reset = true
					} else {
						return
					}
				}
				if _, ok := states[c.NodeID]; ok {
					ids[c.NodeID] = true
				}
			}
			if reset {
				nodes, err := a.metricNodes(r.Context(), q)
				if err == auth.ErrNotFound {
					streamJSON(w, "metrics", MetricFrame{Reset: true, Items: map[string]monitoring.LiveSnapshot{}, RemovedIDs: []string{q.node}})
					return
				}
				if err != nil {
					return
				}
				next := map[string]string{}
				for _, node := range nodes {
					next[node.ID] = node.State
					ids[node.ID] = true
				}
				for id := range states {
					if _, ok := next[id]; !ok {
						removed = append(removed, id)
						delete(ids, id)
						delete(cursors, id)
					}
				}
				states = next
			}
			if err := demand.Update(scopeIDs(), time.Now()); err != nil {
				streamJSON(w, "closed", struct{}{})
				return
			}
			if len(ids) > 0 || reset {
				if !send(ids, reset, removed) {
					return
				}
			}
		}
	}
}

type metricScope struct{ node, through string }

func parseMetricScope(r *http.Request) (metricScope, error) {
	q, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		return metricScope{}, auth.ErrInvalid
	}
	if len(q) != 1 {
		return metricScope{}, auth.ErrInvalid
	}
	for key, values := range q {
		if (key != "node" && key != "through") || len(values) != 1 || len(values[0]) == 0 || len(values[0]) > 128 {
			return metricScope{}, auth.ErrInvalid
		}
	}
	return metricScope{node: q.Get("node"), through: q.Get("through")}, nil
}
func (a *api) metricNodes(ctx context.Context, q metricScope) ([]inventory.Node, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if q.node != "" {
		node, err := a.Nodes.Node(ctx, q.node)
		return []inventory.Node{node}, err
	}
	// Stable ascending node IDs match listNodes pagination. The range avoids a
	// growing URL of IDs as the user loads additional pages.
	nodes, err := a.Nodes.Nodes(ctx, monitoring.MaxNodes+1, "")
	if err != nil {
		return nil, err
	}
	end := 0
	for end < len(nodes) && nodes[end].ID <= q.through {
		end++
	}
	if end > monitoring.MaxNodes {
		return nil, auth.ErrInvalid
	}
	return nodes[:end], nil
}
