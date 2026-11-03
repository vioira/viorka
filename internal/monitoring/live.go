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
