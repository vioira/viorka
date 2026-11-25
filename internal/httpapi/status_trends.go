package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/vioira/viorka/internal/monitoring"
	"github.com/vioira/viorka/internal/realtime"
)

type statusTrendEvent struct {
	NodeID string                  `json:"node_id"`
	Charts monitoring.MetricTrends `json:"charts"`
}

// A detail visitor owns only a chart cursor. The shared public feed owns Agent demand.
type statusTrendStream struct {
	node     string
	revision int64
	cursor   monitoring.Cursor
	windows  *monitoring.MetricTrendWindows
	sub      *realtime.Subscription
	wake     <-chan struct{}
	next     <-chan time.Time
	reset    bool
}

func (s *statusTrendStream) close() {
	if s.sub != nil {
		s.sub.Close()
	}
	*s = statusTrendStream{node: s.node}
}

func (s *statusTrendStream) subscribe(a *api, page StatusPage, revision int64) bool {
	s.close()
	if s.node == "" || !page.Live {
		return false
	}
	for _, n := range page.Nodes {
		if n.ID == s.node {
			id := n.ID
			s.sub = a.Events.Subscribe(func(c realtime.Change) bool {
				return c.NodeID == id && (c.Kind == "metrics" || c.Kind == "node")
			})
			s.wake = s.sub.Wake
			s.revision = revision
			s.reset = true
			return true
		}
	}
	return false
}

func (s *statusTrendStream) changed() {
	_, reset := s.sub.Drain()
	s.reset = s.reset || reset
	if s.next == nil {
		s.next = time.After(time.Until(statusWindowEnd(time.Now())))
	}
}

func (s *statusTrendStream) send(ctx context.Context, w http.ResponseWriter, a *api, repo statusRepository) bool {
	s.next = nil
	if a.Gateway == nil {
		return false
	}
	if s.reset {
		s.cursor = monitoring.Cursor{}
	}
	value, err := a.Gateway.ReadMetrics(s.node, s.cursor, false)
	if err != nil {
		slog.Warn("Public trend stream interrupted", "node", s.node, "error", err)
		return false
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	value, err = a.metricTrends(ctx, s.node, value, &s.windows, s.reset)
	if err != nil {
		slog.Warn("Public trend stream interrupted", "node", s.node, "error", err)
		return false
	}
	s.cursor = monitoring.Cursor{Generation: value.Generation, Sequence: value.Sequence}
	s.reset = false
	for _, chart := range value.MetricTrends {
		if chart.Reset || len(chart.Points) > 0 || len(chart.RemovedIDs) > 0 {
			// Recheck after reading history. The shared feed will send a new
			// snapshot or withdrawal if the publication changed in flight.
			rev, _, enabled, err := repo.StatusVersion(ctx)
			if err != nil {
				return false
			}
			if !enabled || rev != s.revision {
				s.close()
				return true
			}
			return streamJSON(w, "metric_trends", statusTrendEvent{s.node, value.MetricTrends})
		}
	}
	return true
}
