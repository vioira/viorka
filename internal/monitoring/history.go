package monitoring

import (
	"context"
	"time"
)

// History contains only typed observations from the new 30-second store.
type History struct {
	PeriodSeconds int      `json:"period_seconds"`
	Points        []Bucket `json:"points"`
}
type HistoryRepository interface {
	MetricHistory(context.Context, string, time.Time, time.Time, int) (History, error)
}

// LiveTrendHistory overlays the recorder's absolute 30-second buckets on the
// database snapshot. Even a just-flushed bucket may be newer than that read.
func (s *TelemetryIngress) LiveTrendHistory(node string, start, end time.Time, stored History) History {
	buckets := make(map[int64]Bucket, len(stored.Points))
	for _, b := range stored.Points {
		buckets[b.Start] = b
	}
	from, until := start.Unix(), end.Unix()
	r := s.recorder
	r.mu.Lock()
	if n := r.nodes[node]; n != nil {
		for _, b := range n.data.Buckets {
			if b.Start >= from && b.Start < until {
				buckets[b.Start] = b
			}
		}
	}
	r.mu.Unlock()

	points := make([]Bucket, 0, len(buckets))
	for at := from; at < until; at += 30 {
		if b, ok := buckets[at]; ok {
			points = append(points, b)
		}
	}
	return History{PeriodSeconds: 30, Points: points}
}
