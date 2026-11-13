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

type MetricSummaryFrame struct {
	Reset      bool                                `json:"reset"`
	Items      map[string]monitoring.MetricSummary `json:"items"`
	RemovedIDs []string                            `json:"removed_ids"`
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
	previous := map[string]monitoring.LiveSnapshot{}
	var trends *monitoring.MetricTrendWindows
	states := map[string]string{}
	for _, node := range nodes {
		states[node.ID] = node.State
	}
	send := func(ids map[string]bool, reset bool, removed []string) bool {
		frame := MetricFrame{Reset: reset, Items: map[string]monitoring.LiveSnapshot{}, RemovedIDs: removed}
		summary := MetricSummaryFrame{Reset: reset, Items: map[string]monitoring.MetricSummary{}, RemovedIDs: removed}
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
			if q.node == "" {
				summary.Items[id] = monitoring.Summarize(value.Snapshot)
			} else {
				if q.view == "live" {
					value, err = a.metricTrends(r.Context(), id, value, &trends, reset)
					if err != nil {
						return false
					}
				}
				if q.view != "" {
					value = projectMetricView(value, q.view)
					frame.Items[id] = metricDelta(value, previous[id])
					cached := value
					cached.MetricTrends = nil
					if cached.Telemetry != nil {
						t := *cached.Telemetry
						t.Points = nil
						cached.Telemetry = &t
					}
					previous[id] = cached
				} else {
					frame.Items[id] = value
				}
			}
		}
		if q.node == "" {
			return streamJSON(w, "metrics", summary)
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
	// Drain invalidations promptly while a non-sliding window collects node IDs.
	// A nil timer channel keeps idle streams asleep; access changes bypass batching.
	interval := 100 * time.Millisecond
	if q.node == "" || q.view != "" {
		interval = 5 * time.Second
	}
	if q.view == "live" {
		interval = 2 * time.Second
	}
	var batch *time.Timer
	var batchReady <-chan time.Time
	defer func() {
		if batch != nil {
			batch.Stop()
		}
	}()
	pending := map[string]bool{} // true means node metadata must also be re-read
	pendingReset := false
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
			changes, reset := sub.Drain()
			pendingReset = pendingReset || reset
			checkAccess := reset
			for _, c := range changes {
				switch c.Kind {
				case "access", "settings":
					checkAccess = true
				case "nodes":
					pendingReset = true
				case "node", "metrics":
					if _, ok := states[c.NodeID]; ok {
						pending[c.NodeID] = pending[c.NodeID] || c.Kind == "node"
					} else if c.Kind == "node" {
						pendingReset = true
					}
				}
			}
			if checkAccess && !a.streamAccess(r) {
				streamJSON(w, "closed", struct{}{})
				return
			}
			if batchReady == nil && (len(pending) > 0 || pendingReset) {
				batch = time.NewTimer(interval)
				batchReady = batch.C
			}
		case <-batchReady:
			batchReady = nil
			if !a.streamAccess(r) {
				streamJSON(w, "closed", struct{}{})
				return
			}
			reset := pendingReset
			pendingReset = false
			ids := map[string]bool{}
			removed := []string{}
			for id, readNode := range pending {
				ids[id] = true
				if readNode && !reset {
					ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
					node, err := a.Nodes.Node(ctx, id)
					cancel()
					if err == nil {
						states[id] = node.State
					} else if err == auth.ErrNotFound {
						reset = true
					} else {
						return
					}
				}
			}
			clear(pending)
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

type metricScope struct{ node, through, view string }

func parseMetricScope(r *http.Request) (metricScope, error) {
	q, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		return metricScope{}, auth.ErrInvalid
	}
	if len(q) != 1 && !(len(q) == 2 && q.Get("node") != "" && q.Get("view") != "") {
		return metricScope{}, auth.ErrInvalid
	}
	for key, values := range q {
		if (key != "node" && key != "through" && key != "view") || len(values) != 1 || len(values[0]) == 0 || len(values[0]) > 128 {
			return metricScope{}, auth.ErrInvalid
		}
	}
	view := q.Get("view")
	if view != "" && (q.Get("node") == "" || (view != "overview" && view != "live" && view != "history" && view != "settings")) {
		return metricScope{}, auth.ErrInvalid
	}
	return metricScope{node: q.Get("node"), through: q.Get("through"), view: view}, nil
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
