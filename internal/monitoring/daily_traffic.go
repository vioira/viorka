package monitoring

import (
	"context"
	"errors"
	v1 "github.com/vioira/viorka/protocol/v1"
	"time"
)

var ErrDailyTrafficConflict = errors.New("daily traffic revision conflict")

// DailyTrafficConflictError identifies a failed invariant without record values.
type DailyTrafficConflictError struct{ Reason string }

func (e *DailyTrafficConflictError) Error() string { return "daily traffic conflict: " + e.Reason }
func (e *DailyTrafficConflictError) Unwrap() error { return ErrDailyTrafficConflict }

type DailyTrafficRepository interface {
	SaveDailyTraffic(context.Context, string, []*v1.TelemetryDailyTraffic) ([]*v1.TelemetryDailyTrafficAck, error)
	DailyTraffic(context.Context, string, time.Time, time.Time) ([]*v1.TelemetryDailyTraffic, error)
}
