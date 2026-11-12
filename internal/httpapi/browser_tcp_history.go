package httpapi

import (
	"context"
	"errors"
	"sort"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/monitoring"
	"github.com/vioira/viorka/internal/realtime"
)

type browserTCPHistorySubscription struct {
	Node       string `json:"node"`
	Range      string `json:"range"`
	Generation uint64 `json:"generation"`
}
type tcpHistoryKey = int64
type browserTCPHistoryFrame struct {
	monitoring.TCPHistory
	Node    string   `json:"node_id"`
	Range   string   `json:"range"`
	Reset   bool     `json:"reset"`
	Targets []string `json:"targets"`
}

// A single selected history shares the layout's socket. Only committed changes
// enter pending; normal updates never re-query the database.
type browserTCPHistory struct {
	a                    *api
	subscription         browserTCPHistorySubscription
	duration             time.Duration
	period               int
	reset, dirty, failed bool
	points               map[tcpHistoryKey]monitoring.TCPHistoryPoint
	previous             map[tcpHistoryKey]monitoring.TCPHistoryPoint
	pending              map[tcpHistoryKey]monitoring.TCPHistoryPoint
	next                 time.Time
}

func (h *browserTCPHistory) set(s *browserTCPHistorySubscription) bool {
	if s == nil {
		*h = browserTCPHistory{a: h.a}
		return true
	}
	if !browserID.MatchString(s.Node) || s.Generation == 0 {
		return false
	}
	duration, period := time.Hour, 60
	switch s.Range {
	case "1h":
	case "6h":
		duration = 6 * time.Hour
		period = 300
	case "24h":
		duration = 24 * time.Hour
		period = 900
	case "7d":
		duration = 168 * time.Hour
		period = 3600
	default:
		return false
	}
	if *s == h.subscription {
		return true
	}
	*h = browserTCPHistory{a: h.a, subscription: *s, duration: duration, period: period, reset: true, dirty: true, pending: map[tcpHistoryKey]monitoring.TCPHistoryPoint{}}
	return true
}
func (h *browserTCPHistory) change(c realtime.Change) {
	if h.failed || h.subscription.Node == "" || c.NodeID != h.subscription.Node || c.TCPProbe == nil {
		return
	}
	p := monitoring.TCPHistoryPoint{BucketStart: c.TCPProbe.SampledAt.Truncate(time.Minute).Unix(), TelemetryTCPProbeBatch: *c.TCPProbe}
	key := p.BucketStart
	if old, ok := h.pending[key]; !ok || p.SampledAt.After(old.SampledAt) {
		h.pending[key] = p
	}
	if len(h.pending) > 256 {
		clear(h.pending)
		h.reset = true
	}
	h.dirty = true
}
func (h *browserTCPHistory) due(now time.Time) bool {
	if h.failed || h.subscription.Node == "" || now.Before(h.next) {
		return false
	}
	if h.reset || h.dirty {
		return true
	}
	for _, p := range h.pending {
		if p.SampledAt.Before(now) {
			return true
		}
	}
	for _, p := range h.points {
		if p.SampledAt.Before(now.Add(-h.duration)) {
			return true
		}
	}
	return false
}
func (h *browserTCPHistory) send(ctx context.Context, send func(browserFrame) bool, now time.Time) bool {
	now = now.UTC().Truncate(time.Millisecond)
	queryCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	fail := func(code string, status int, message string) bool {
		h.reset = false
		h.dirty = false
		h.failed = true
		clear(h.pending)
		h.next = now.Add(5 * time.Second)
		return send(browserFrame{Type: "event", Event: "tcp_history_error", Generation: h.subscription.Generation, Status: status, Data: ErrorResponse{Code: code, Message: message}})
	}
	if _, err := h.a.Nodes.Node(queryCtx, h.subscription.Node); err != nil {
		if errors.Is(err, auth.ErrNotFound) {
			return fail("not_found", 404, "节点不存在")
		}
		return fail("history_unavailable", 503, "TCP 历史读取失败，请刷新重试")
	}
	start := now.Add(-h.duration)
	targets := map[string]bool{}
	for _, p := range h.points {
		for _, probe := range p.Targets {
			targets[probe.Target] = true
		}
	}

	for _, p := range h.pending {
		if !p.SampledAt.Before(start) && p.SampledAt.Before(now) {
			for _, probe := range p.Targets {
				if !targets[probe.Target] {
					h.reset = true
				}
			}
		}
	}

	if h.reset {
		if h.a.TCPHistory == nil {
			return fail("history_unavailable", 503, "TCP 历史存储不可用，请稍后重试")
		}
		data, err := h.a.TCPHistory.TCPProbeHistory(queryCtx, h.subscription.Node, "", start, now, now, h.period)
		if err != nil {
			return fail("history_unavailable", 503, "TCP 历史读取失败，请刷新重试")
		}
		h.points = map[tcpHistoryKey]monitoring.TCPHistoryPoint{}
		for _, p := range data.Points {
			h.points[p.BucketStart] = p
		}
	} else {
		for _, p := range h.pending {
			if p.SampledAt.Before(start) || !p.SampledAt.Before(now) {
				continue
			}
			p.BucketStart = p.SampledAt.Unix() / int64(h.period) * int64(h.period)
			key := p.BucketStart
			if old, ok := h.points[key]; !ok || p.SampledAt.After(old.SampledAt) {
				h.points[key] = p
			}
		}
	}
	for key, p := range h.pending {
		if p.SampledAt.Before(now) {
			delete(h.pending, key)
		}
	}
	for key, p := range h.points {
		if p.SampledAt.Before(start) {
			delete(h.points, key)
		}
	}
	frame := browserTCPHistoryFrame{TCPHistory: monitoring.TCPHistory{Start: start.UTC(), End: now.UTC(), PeriodSeconds: h.period, Points: []monitoring.TCPHistoryPoint{}}, Node: h.subscription.Node, Range: h.subscription.Range, Reset: h.reset, Targets: []string{}}
	targets = map[string]bool{}
	for key, p := range h.points {
		for _, probe := range p.Targets {
			targets[probe.Target] = true
		}
		old, ok := h.previous[key]
		if h.reset || !ok || p.SampledAt.After(old.SampledAt) {
			frame.Points = append(frame.Points, p)
		}
	}
	for target := range targets {
		frame.Targets = append(frame.Targets, target)
	}
	sort.Strings(frame.Targets)
	sort.Slice(frame.Points, func(i, j int) bool { return frame.Points[i].BucketStart < frame.Points[j].BucketStart })
	changed := h.reset || len(frame.Points) > 0 || len(h.points) != len(h.previous)
	if changed && !send(browserFrame{Type: "event", Event: "tcp_history", Generation: h.subscription.Generation, Data: frame}) {
		return false
	}
	h.previous = make(map[tcpHistoryKey]monitoring.TCPHistoryPoint, len(h.points))
	for key, p := range h.points {
		h.previous[key] = p
	}
	h.reset = false
	h.dirty = false
	h.next = now.Add(time.Second)
	return true
}
