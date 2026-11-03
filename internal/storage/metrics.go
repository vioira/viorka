package storage

import (
	"context"
	"github.com/vioira/viorka/internal/monitoring"
	"time"
)

func (s *Store) MetricHistory(ctx context.Context, id string, start, end time.Time, period int) (monitoring.History, error) {
	rows, err := s.TelemetryHistory(ctx, id, start, end, end, period)
	return monitoring.History{PeriodSeconds: period, Points: rows}, err
}
