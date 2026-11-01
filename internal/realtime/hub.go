// Package realtime distributes bounded, ephemeral invalidations. Durable state
// remains in its owning repository; reconnecting clients always resynchronize.
package realtime

import "sync"

type Change struct {
	Kind   string `json:"kind"`
	NodeID string `json:"node_id,omitempty"`
	UserID string `json:"-"`
}

type Hub struct {
	mu   sync.Mutex
	subs map[*Subscription]struct{}
}

type Subscription struct {
	hub     *Hub
	Wake    chan struct{}
	filter  func(Change) bool
	pending map[Change]struct{}
	reset   bool
}

func New() *Hub { return &Hub{subs: make(map[*Subscription]struct{})} }

// Source lets adapters share the application hub without a global singleton.
type Source interface{ Events() *Hub }

func (h *Hub) Subscribe(filter func(Change) bool) *Subscription {
	s := &Subscription{hub: h, Wake: make(chan struct{}, 1), filter: filter, pending: make(map[Change]struct{})}
	h.mu.Lock()
	h.subs[s] = struct{}{}
	h.mu.Unlock()
	return s
}

func (h *Hub) Publish(c Change) {
	if h == nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for s := range h.subs {
		if !s.filter(c) {
			continue
		}
		if !s.reset {
			s.pending[c] = struct{}{}
			if len(s.pending) > 256 {
				clear(s.pending)
				s.reset = true
			}
		}
		select {
		case s.Wake <- struct{}{}:
		default:
		}
	}
}

func (s *Subscription) Drain() ([]Change, bool) {
	s.hub.mu.Lock()
	defer s.hub.mu.Unlock()
	changes := make([]Change, 0, len(s.pending))
	for c := range s.pending {
		changes = append(changes, c)
	}
	reset := s.reset
	clear(s.pending)
	s.reset = false
	return changes, reset
}

func (s *Subscription) Close() {
	s.hub.mu.Lock()
	delete(s.hub.subs, s)
	s.hub.mu.Unlock()
}
