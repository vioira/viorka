package monitoring

import (
	"context"
	"errors"
	"time"

	v1 "github.com/vioira/viorka/protocol/v1"
)

// TCPHistoryPoint is a window snapshot, never an aggregate of overlapping windows.
type TCPHistoryPoint struct {
	BucketStart int64 `json:"bucket_start"`
	v1.TelemetryTCPProbeBatch
}
type TCPHistory struct {
	Start         time.Time         `json:"start"`
	End           time.Time         `json:"end"`
	PeriodSeconds int               `json:"period_seconds"`
	Points        []TCPHistoryPoint `json:"points"`
}
type TCPHistoryRepository interface {
	TCPProbeHistory(context.Context, string, string, time.Time, time.Time, time.Time, int) (TCPHistory, error)
}

var ErrTCPHistoryRange = errors.New("invalid TCP history range")

func ValidateTCPHistoryRange(start, end, now time.Time, period int) error {
	switch period {
	case 60, 300, 900, 3600:
	default:
		return ErrTCPHistoryRange
	}
	if start.Unix() < 0 || !end.After(start) || end.Sub(start) > 168*time.Hour || start.Before(now.Add(-168*time.Hour)) || end.After(now.Add(time.Minute)) {
		return ErrTCPHistoryRange
	}
	// Include partial first/last display buckets in the response budget.
	if (end.Add(-time.Nanosecond).Unix()/int64(period))-(start.Unix()/int64(period))+1 > 240 {
		return ErrTCPHistoryRange
	}
	return nil
}

func addTCPHistory(n *NodeHistory, batch *v1.TelemetryTCPProbeBatch) {
	point := TCPHistoryPoint{BucketStart: batch.SampledAt.UTC().Truncate(time.Minute).Unix(), TelemetryTCPProbeBatch: *batch}
	point.Targets = make([]*v1.TelemetryTCPProbe, len(batch.Targets))
	for i, probe := range batch.Targets {
		copy := *probe
		point.Targets[i] = &copy
	}
	for i, old := range n.TCPProbes {
		if old.BucketStart == point.BucketStart {
			if point.SampledAt.After(old.SampledAt) {
				n.TCPProbes[i] = point
			}
			return
		}
	}
	n.TCPProbes = append(n.TCPProbes, point)
}
