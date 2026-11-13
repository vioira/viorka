package monitoring

import (
	"context"
	"errors"
	v1 "github.com/vioira/viorka/protocol/v1"
	"time"
)

var ErrDailyTrafficConflict = errors.New("daily traffic revision conflict")

type DailyTrafficRepository interface {
	SaveDailyTraffic(context.Context, string, []*v1.TelemetryDailyTraffic) ([]*v1.TelemetryDailyTrafficAck, error)
	DailyTraffic(context.Context, string, time.Time, time.Time) ([]*v1.TelemetryDailyTraffic, error)
}
