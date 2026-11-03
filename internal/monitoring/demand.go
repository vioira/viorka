package monitoring

import (
	"fmt"
	"sync"
	"time"
)

const MaxDemandSubscriptions = 128
const DemandGrace = 15 * time.Second

type DemandState struct {
	References int
	GraceUntil time.Time
}

// Demands owns process-local, server-authorized SSE scopes. It has no timers or
// persistence: gateway owners read grace/renewal deadlines on their own clocks.
type Demands struct {
	mu            sync.Mutex
	nodes         map[string]DemandState
	subscriptions int
	changed       func(string)
}
type DemandSubscription struct {
	owner  *Demands
	nodes  map[string]bool
	closed bool
}

func NewDemands(changed func(string)) *Demands {
	return &Demands{nodes: map[string]DemandState{}, changed: changed}
}
func (d *Demands) Subscribe(nodes []string, now time.Time) (*DemandSubscription, error) {
	d.mu.Lock()
	if d.subscriptions >= MaxDemandSubscriptions {
		d.mu.Unlock()
		return nil, fmt.Errorf("telemetry subscription limit")
	}
	s := &DemandSubscription{owner: d, nodes: map[string]bool{}}
	changed, err := s.updateLocked(nodes, now)
	if err == nil {
		d.subscriptions++
	}
	d.mu.Unlock()
	d.notify(changed)
	if err != nil {
		return nil, err
	}
	return s, nil
}
func (s *DemandSubscription) Update(nodes []string, now time.Time) error {
	d := s.owner
	d.mu.Lock()
	if s.closed {
		d.mu.Unlock()
		return fmt.Errorf("closed telemetry subscription")
	}
	changed, err := s.updateLocked(nodes, now)
	d.mu.Unlock()
	d.notify(changed)
	return err
}
func (s *DemandSubscription) updateLocked(nodes []string, now time.Time) ([]string, error) {
	if len(nodes) > MaxNodes || now.IsZero() {
		return nil, fmt.Errorf("invalid telemetry scope")
	}
	next := map[string]bool{}
	for _, node := range nodes {
		if node == "" || len(node) > 128 {
			return nil, fmt.Errorf("invalid telemetry node")
		}
		next[node] = true
	}
	d := s.owner
	// Expired zero-reference records have no ownership and may be reclaimed.
	for node, state := range d.nodes {
		if state.References == 0 && !now.Before(state.GraceUntil) {
			delete(d.nodes, node)
		}
	}
	total := len(d.nodes)
	for node := range next {
		if _, ok := d.nodes[node]; !ok {
			total++
		}
	}
	if total > MaxNodes {
		return nil, fmt.Errorf("telemetry demand node limit")
	}
	changed := []string{}
	for node := range s.nodes {
		if !next[node] {
			state := d.nodes[node]
			state.References--
			if state.References == 0 {
				state.GraceUntil = now.Add(DemandGrace)
			}
			d.nodes[node] = state
			changed = append(changed, node)
		}
	}
	for node := range next {
		if !s.nodes[node] {
			state := d.nodes[node]
			state.References++
			state.GraceUntil = time.Time{}
			d.nodes[node] = state
			changed = append(changed, node)
		}
	}
	s.nodes = next
	return changed, nil
}
func (s *DemandSubscription) Close(now time.Time) {
	d := s.owner
	d.mu.Lock()
	if s.closed {
		d.mu.Unlock()
		return
	}
	if now.IsZero() {
		now = time.Now()
	}
	changed := make([]string, 0, len(s.nodes))
	for node := range s.nodes {
		state := d.nodes[node]
		state.References--
		if state.References == 0 {
			state.GraceUntil = now.Add(DemandGrace)
		}
		d.nodes[node] = state
		changed = append(changed, node)
	}
	s.nodes = nil
	s.closed = true
	d.subscriptions--
	d.mu.Unlock()
	d.notify(changed)
}
func (d *Demands) State(node string) DemandState {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.nodes[node]
}
func (d *Demands) notify(nodes []string) {
	if d.changed != nil {
		for _, node := range nodes {
			d.changed(node)
		}
	}
}
