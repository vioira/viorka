package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/monitoring"
)

type browserMetrics struct {
	trends       *monitoring.MetricTrendWindows
	a            *api
	demand       *monitoring.DemandSubscription
	scope        string
	generation   uint64
	q            metricScope
	cursors      map[string]monitoring.Cursor
	previous     map[string]monitoring.LiveSnapshot
	reset, dirty bool
	next         time.Time
}

func (m *browserMetrics) clear() { m.cursors = nil; m.previous = nil; m.trends = nil }
func (m *browserMetrics) set(ctx context.Context, scope string, generation uint64, enabled bool) bool {
	if generation < m.generation {
		return true
	}
	if generation == m.generation && scope == m.scope && enabled && m.cursors != nil {
		return true
	}
	m.generation = generation
	m.scope = scope
	if scope == "" || !enabled {
		m.clear()
		return m.demand.Update(nil, time.Now()) == nil
	}
	q, err := parseMetricScope(&http.Request{URL: &url.URL{RawQuery: scope}})
	if err != nil {
		m.scope = ""
		m.demand.Update(nil, time.Now())
		return false
	}
	nodes, err := m.a.metricNodes(ctx, q)
	if err != nil {
		m.scope = ""
		m.demand.Update(nil, time.Now())
		return false
	}
	ids := make([]string, 0, len(nodes))
	for _, n := range nodes {
		ids = append(ids, n.ID)
	}
	if err = m.demand.Update(ids, time.Now()); err != nil {
		m.scope = ""
		return false
	}
	// Preserve sampling cursors while changing only the detail projection.
	if q.node != m.q.node || q.through != m.q.through || m.cursors == nil {
		m.cursors = map[string]monitoring.Cursor{}
	}
	m.previous = map[string]monitoring.LiveSnapshot{}
	m.q = q
	m.reset = true
	m.dirty = true
	m.next = time.Time{}
	return true
}
func (m *browserMetrics) send(ctx context.Context, send func(browserFrame) bool) bool {
	nodes, err := m.a.metricNodes(ctx, m.q)
	if errors.Is(err, auth.ErrNotFound) {
		scopeNode := m.q.node
		m.scope = ""
		m.demand.Update(nil, time.Now())
		return send(browserFrame{Type: "event", Event: "metrics", Generation: m.generation, Data: MetricFrame{Reset: true, Items: map[string]monitoring.LiveSnapshot{}, RemovedIDs: []string{scopeNode}}})
	}
	if err != nil {
		return false
	}
	frame := MetricFrame{Reset: m.reset, Items: map[string]monitoring.LiveSnapshot{}, RemovedIDs: []string{}}
	summary := MetricSummaryFrame{Reset: m.reset, Items: map[string]monitoring.MetricSummary{}, RemovedIDs: []string{}}
	ids := make([]string, 0, len(nodes))
	present := map[string]bool{}
	for _, node := range nodes {
		ids = append(ids, node.ID)
		present[node.ID] = true
		after := m.cursors[node.ID]
		if m.reset {
			after = monitoring.Cursor{}
		}
		value, err := m.a.Gateway.ReadMetrics(node.ID, after, m.q.node == "")
		if err != nil {
			return false
		}
		value.ManagementOnline = node.State == "online"
		if node.State != "online" && value.Telemetry == nil {
			value.Stale = true
		}
		m.cursors[node.ID] = monitoring.Cursor{Sequence: value.Sequence, Generation: value.Generation}
		if m.q.node == "" {
			summary.Items[node.ID] = monitoring.Summarize(value.Snapshot)
		} else {
			if m.q.view == "live" {
				value, err = m.a.metricTrends(ctx, node.ID, value, &m.trends, m.reset)
				if err != nil {
					return false
				}
			}
			value = projectMetricView(value, m.q.view)
			frame.Items[node.ID] = metricDelta(value, m.previous[node.ID])
			cached := value
			cached.MetricTrends = nil
			if cached.Telemetry != nil {
				t := *cached.Telemetry
				t.Points = nil
				cached.Telemetry = &t
			}
			m.previous[node.ID] = cached
		}
	}
	for id := range m.cursors {
		if !present[id] {
			frame.RemovedIDs = append(frame.RemovedIDs, id)
			summary.RemovedIDs = append(summary.RemovedIDs, id)
			delete(m.cursors, id)
			delete(m.previous, id)
		}
	}
	if m.demand.Update(ids, time.Now()) != nil {
		return false
	}
	var data any = frame
	if m.q.node == "" {
		data = summary
	}
	if !send(browserFrame{Type: "event", Event: "metrics", Generation: m.generation, Data: data}) {
		return false
	}
	m.reset = false
	m.dirty = false
	interval := 5 * time.Second
	if m.q.view == "live" {
		interval = 2 * time.Second
	}
	m.next = time.Now().Add(interval)
	return true
}
