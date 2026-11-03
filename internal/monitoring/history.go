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
