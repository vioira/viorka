package monitoring

import "time"

const MaxLivePoints = 600

// Raw cache retains ten minutes at one sample/second.
const MaxLiveSamples = 600
const LiveWindow = 10 * time.Minute

// LivePoint is a projection, not a copy of the potentially large host snapshot.
type LivePoint struct {
	Sequence   uint64             `json:"sequence"`
	At         time.Time          `json:"at"`
	ReceivedAt time.Time          `json:"received_at"`
	Values     map[string]float64 `json:"values"`
}

type Cursor struct{ Sequence, Generation uint64 }

type LiveSnapshot struct {
	Generation uint64 `json:"-"`
	Snapshot
	Sequence uint64      `json:"sequence"`
	Points   []LivePoint `json:"points"`
	Reset    bool        `json:"reset"`
}

// Live returns an atomic latest snapshot and its corresponding sample window.
// Sequence is scoped to a node cache lifetime. Every new stream resets it.
func (s *Store) Live(node string, now time.Time, cursor Cursor) LiveSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := LiveSnapshot{Snapshot: s.snapshot(node, now, false), Points: []LivePoint{}}
	e, ok := s.entries[node]
	if !ok {
		out.Reset = true
		return out
	}
	out.Sequence = e.sequence
	out.Generation = e.generation
	after := cursor.Sequence
	out.Reset = cursor.Generation != e.generation || after == 0 || after > e.sequence || (len(e.live) > 0 && after < e.live[0].Sequence-1)
	for _, p := range e.live {
		if p.ReceivedAt.After(now.Add(-LiveWindow)) && (out.Reset || p.Sequence > after) {
			out.Points = append(out.Points, p)
		}
	}
	if len(out.Points) > MaxLivePoints && !out.Reset {
		out.Reset = true
		out.Points = nil
		for _, p := range e.live {
			if p.ReceivedAt.After(now.Add(-LiveWindow)) {
				out.Points = append(out.Points, p)
			}
		}
	}
	return out
}

func (s *Store) LiveSummary(node string, now time.Time) LiveSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	e := s.entries[node]
	return LiveSnapshot{Snapshot: s.snapshot(node, now, false), Sequence: e.sequence, Generation: e.generation, Reset: true, Points: []LivePoint{}}
}
