package storage

import (
	"context"
	"time"

	"github.com/vioira/viorka/internal/realtime"
)

func (s *Store) SaveNodeUptime(ctx context.Context, node string, seconds float64, sampled time.Time, legacy bool) (bool, error) {
	cutoff := sampled
	if legacy {
		cutoff = sampled.Add(-10 * time.Minute)
	}
	stamp := at(sampled)
	result, err := s.db.ExecContext(ctx, `UPDATE nodes SET uptime_seconds=?,uptime_sampled_at=? 
 WHERE id=? AND (uptime_sampled_at IS NULL OR (uptime_sampled_at<? AND uptime_sampled_at<=?))`, seconds, stamp, node, stamp, at(cutoff))
	if err != nil {
		return false, err
	}
	count, err := result.RowsAffected()
	if err == nil && count == 1 {
		s.events.Publish(realtime.Change{Kind: "node", NodeID: node})
	}
	return count == 1, err
}
