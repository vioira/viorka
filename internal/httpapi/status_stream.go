package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/monitoring"
	"github.com/vioira/viorka/internal/realtime"
)

// A single producer owns the public demand and projections for all visitors.
type statusAudience struct {
	mu      sync.Mutex
	current *statusBroadcast
}
type statusBroadcast struct {
	cancel   context.CancelFunc
	viewers  map[chan statusFrame]struct{}
	snapshot statusFrame
}
type statusFrame struct {
	event              string
	value              any
	revision, category int64
	final              bool
}

func (a *api) joinStatus(repo statusRepository) (<-chan statusFrame, func()) {
	h := &a.status.live
	h.mu.Lock()
	defer h.mu.Unlock()
	b := h.current
	if b == nil {
		ctx, cancel := context.WithCancel(a.Shutdown)
		b = &statusBroadcast{cancel: cancel, viewers: make(map[chan statusFrame]struct{})}
		h.current = b
		go func() {
			if err := a.runStatusBroadcast(ctx, repo, b); err != nil && ctx.Err() == nil {
				slog.Warn("Public status stream interrupted", "error", err)
			}
			h.mu.Lock()
			defer h.mu.Unlock()
			if h.current == b {
				h.current = nil
			}
			for ch := range b.viewers {
				close(ch)
			}
			cancel()
		}()
	}
	ch := make(chan statusFrame, 8)
	b.viewers[ch] = struct{}{}
	if b.snapshot.event != "" {
		ch <- b.snapshot
	}
	return ch, func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		delete(b.viewers, ch)
		if len(b.viewers) == 0 {
			b.cancel()
			if h.current == b {
				h.current = nil
			}
		}
	}
}

func (a *api) publishStatus(b *statusBroadcast, snapshot, update statusFrame) {
	h := &a.status.live
	h.mu.Lock()
	defer h.mu.Unlock()
	b.snapshot = snapshot
	for ch := range b.viewers {
		select {
		case ch <- update:
		default:
			// This producer is the only sender. Discard queued patches when
			// the visitor falls behind and establish a fresh baseline.
		drain:
			for {
				select {
				case <-ch:
				default:
					break drain
				}
			}
			ch <- snapshot
		}
	}
}

func (a *api) statusEvents(w http.ResponseWriter, r *http.Request, repo statusRepository) {
	query := r.URL.Query()
	for key, values := range query {
		if key != "node" || len(values) != 1 || values[0] == "" {
			problem(w, auth.ErrInvalid)
			return
		}
	}
	trends := statusTrendStream{node: query.Get("node")}
	defer trends.close()
	select {
	case a.status.streams <- struct{}{}:
		defer func() { <-a.status.streams }()
	default:
		fail(w, 429, "stream_limit", "连接过多，请稍后重试")
		return
	}
	frames, leave := a.joinStatus(repo)
	defer leave()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("X-Accel-Buffering", "no")
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-a.Shutdown.Done():
			return
		case <-heartbeat.C:
			if !streamFrame(w, ": heartbeat\n\n") {
				return
			}
		case <-trends.wake:
			trends.changed()
		case <-trends.next:
			if !trends.send(r.Context(), w, a, repo) {
				return
			}
		case frame, ok := <-frames:
			if !ok {
				// Flush an SSE response even when the initial build failed so EventSource retries.
				streamFrame(w, ": reconnect\n\n")
				return
			}
			if frame.event != "withdrawn" {
				ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
				rev, cat, on, err := repo.StatusVersion(ctx)
				cancel()
				if err != nil {
					return
				}
				if !on {
					streamFrame(w, "event: withdrawn\ndata: {}\n\n")
					return
				}
				if rev != frame.revision || cat != frame.category {
					continue
				}
			}
			if !streamJSON(w, frame.event, frame.value) || frame.final {
				return
			}
			if page, ok := frame.value.(StatusPage); ok && trends.subscribe(a, page, frame.revision) {
				if !trends.send(r.Context(), w, a, repo) {
					return
				}
			}
		}
	}
}

func (a *api) runStatusBroadcast(ctx context.Context, repo statusRepository, b *statusBroadcast) error {
	var scope atomic.Pointer[map[string]*statusStreamNode]
	sub := a.Events.Subscribe(func(c realtime.Change) bool {
		if c.NodeID != "" {
			if nodes := scope.Load(); nodes != nil {
				if _, published := (*nodes)[c.NodeID]; !published {
					return false
				}
			}
		}
		switch c.Kind {
		case "public_status", "settings", "nodes", "node", "metrics", "tcp_history", "telemetry_settings_result", "telemetry_settings":
			return true
		}
		return c.DailyTraffic
	})
	defer sub.Close()
	var demand *monitoring.DemandSubscription
	defer func() {
		if demand != nil {
			demand.Close(time.Now())
		}
	}()
	var feed *statusFeed
	window := statusWindow{nodes: make(map[string]StatusNode)}
	var timer *time.Timer
	var ready <-chan time.Time
	defer func() {
		if timer != nil {
			timer.Stop()
		}
	}()
	flush := func() error {
		read, cancel := context.WithTimeout(ctx, 8*time.Second)
		defer cancel()
		ready = nil
		return a.flushStatusWindow(read, repo, feed, b, &window)
	}
	// Both select cases may be ready at an edge. Close the old window before
	// accepting a new projection even if the change notification wins the race.
	startWindow := func(now time.Time) error {
		if !window.end.IsZero() && !now.Before(window.end) {
			if err := flush(); err != nil {
				return err
			}
		}
		if window.end.IsZero() {
			window.end = statusWindowEnd(now)
			delay := time.Until(window.end)
			if timer == nil {
				timer = time.NewTimer(delay)
			} else {
				timer.Reset(delay)
			}
			ready = timer.C
		}
		return nil
	}
	// Refresh daily currency quotes and retry failed rate lookups on their normal cadence.
	rates := time.NewTicker(15 * time.Minute)
	defer rates.Stop()
	for ctx.Err() == nil {
		if feed == nil {
			scope.Store(nil)
			read, cancel := context.WithTimeout(ctx, 8*time.Second)
			f, err := a.loadStatusFeed(read, repo)
			cancel()
			if errors.Is(err, auth.ErrNotFound) {
				end := statusFrame{event: "withdrawn", value: struct{}{}, final: true}
				a.publishStatus(b, end, end)
				return nil
			}
			if errors.Is(err, auth.ErrConflict) {
				continue
			}
			if err != nil {
				return err
			}
			feed = f
			scope.Store(&f.nodes)
			if f.page.Live && a.Gateway != nil {
				ids := make([]string, 0, len(f.nodes))
				for id := range f.nodes {
					ids = append(ids, id)
				}
				if demand == nil {
					demand, err = a.Gateway.SubscribeTelemetry(ids)
				} else {
					err = demand.Update(ids, time.Now())
				}
				if err != nil {
					return err
				}
			}
			snapshot := feed.snapshot()
			a.publishStatus(b, snapshot, snapshot)
			if snapshot.final {
				return nil
			}
		}
		select {
		case <-ctx.Done():
			return nil
		case <-sub.Wake:
			changes, reset := sub.Drain()
			dirty := map[string]statusDirty{}
			for _, c := range changes {
				switch c.Kind {
				case "public_status", "settings", "nodes":
					reset = true
				default:
					if _, ok := feed.nodes[c.NodeID]; !ok {
						continue
					}
					d := dirty[c.NodeID]
					d.metadata = d.metadata || c.Kind == "node" || c.Kind == "tcp_history" || c.Kind == "telemetry_settings" || c.Kind == "telemetry_settings_result"
					d.lifetime = d.lifetime || c.DailyTraffic
					dirty[c.NodeID] = d
				}
			}
			if reset {
				if timer != nil {
					timer.Stop()
				}
				ready = nil
				clear(window.nodes)
				window.end = time.Time{}
				window.refreshRates = false
				feed = nil
				continue
			}
			for id, change := range dirty {
				read, cancel := context.WithTimeout(ctx, 8*time.Second)
				node, err := a.readChangedStatusNode(read, repo, feed.nodes[id], change, time.Now().UTC())
				cancel()
				if err != nil {
					return err
				}
				if err := startWindow(time.Now()); err != nil {
					return err
				}
				window.nodes[id] = node
			}
		case <-ready:
			if err := flush(); err != nil {
				return err
			}
		case <-rates.C:
			if err := startWindow(time.Now()); err != nil {
				return err
			}
			window.refreshRates = true
		}
	}
	return nil
}
