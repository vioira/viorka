package storage

import (
	"context"
	"database/sql"
	"errors"
	"github.com/vioira/viorka/internal/monitoring"
	"github.com/vioira/viorka/internal/realtime"
	v1 "github.com/vioira/viorka/protocol/v1"
	"strconv"
	"time"
)

func (s *Store) SaveDailyTraffic(ctx context.Context, node string, records []*v1.TelemetryDailyTraffic) ([]*v1.TelemetryDailyTrafficAck, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var registration string
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(enrollment_used_at,'') FROM nodes WHERE id=?`, node).Scan(&registration); err != nil {
		return nil, err
	}
	changed := false
	acks := make([]*v1.TelemetryDailyTrafficAck, 0, len(records))
	for _, d := range records {
		if d == nil || d.Validate() != nil {
			return nil, v1.ErrTelemetryPayload
		}
		rx, _ := strconv.ParseInt(d.RXBytes, 10, 64)
		ty, _ := strconv.ParseInt(d.TXBytes, 10, 64)
		var end, oldRX, oldTX, at, rev, quality int64
		err = tx.QueryRowContext(ctx, `SELECT day_end,rx_bytes,tx_bytes,sampled_at,revision,quality FROM node_daily_traffic WHERE node_id=? AND registration_at=? AND day_start=?`, node, registration, d.DayStart.UnixMilli()).Scan(&end, &oldRX, &oldTX, &at, &rev, &quality)
		switch {
		case errors.Is(err, sql.ErrNoRows):
			changed = true
			var overlaps int
			if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM node_daily_traffic WHERE node_id=? AND registration_at=? AND day_start<? AND day_end>?`, node, registration, d.DayEnd.UnixMilli(), d.DayStart.UnixMilli()).Scan(&overlaps); err != nil {
				return nil, err
			}
			if overlaps > 0 {
				return nil, &monitoring.DailyTrafficConflictError{Reason: "overlapping_interval"}
			}
			_, err = tx.ExecContext(ctx, `INSERT INTO node_daily_traffic(node_id,registration_at,day_start,day_end,rx_bytes,tx_bytes,sampled_at,revision,quality) VALUES(?,?,?,?,?,?,?,?,?)`, node, registration, d.DayStart.UnixMilli(), d.DayEnd.UnixMilli(), rx, ty, d.SampledAt.UnixMilli(), d.Revision, d.Quality)
		case err != nil:
			return nil, err
		case d.Revision == uint64(rev):
			if end != d.DayEnd.UnixMilli() || oldRX != rx || oldTX != ty || at != d.SampledAt.UnixMilli() || quality != int64(d.Quality) {
				return nil, &monitoring.DailyTrafficConflictError{Reason: "same_revision_different_content"}
			}
		case d.Revision > uint64(rev):
			changed = true
			switch {
			case end != d.DayEnd.UnixMilli():
				return nil, &monitoring.DailyTrafficConflictError{Reason: "day_end_changed"}
			case rx < oldRX || ty < oldTX:
				return nil, &monitoring.DailyTrafficConflictError{Reason: "counter_regression"}
			case d.SampledAt.UnixMilli() < at:
				return nil, &monitoring.DailyTrafficConflictError{Reason: "sample_time_regression"}
			case d.Quality&uint64(quality) != uint64(quality):
				return nil, &monitoring.DailyTrafficConflictError{Reason: "quality_regression"}
			}
			_, err = tx.ExecContext(ctx, `UPDATE node_daily_traffic SET rx_bytes=?,tx_bytes=?,sampled_at=?,revision=?,quality=? WHERE node_id=? AND registration_at=? AND day_start=?`, rx, ty, d.SampledAt.UnixMilli(), d.Revision, d.Quality, node, registration, d.DayStart.UnixMilli())
		}
		if err != nil {
			return nil, err
		}
		acks = append(acks, &v1.TelemetryDailyTrafficAck{DayStart: d.DayStart, Revision: d.Revision})
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	if changed {
		s.events.Publish(realtime.Change{Kind: "history", NodeID: node, DailyTraffic: true})
	}
	return acks, nil
}

// A newly registered Agent owns a separate cumulative ledger. Keep old records,
// but display only the newest registration for overlapping reporting intervals.
const latestDailyTraffic = `NOT EXISTS (SELECT 1 FROM node_daily_traffic newer WHERE newer.node_id=d.node_id AND newer.registration_at>d.registration_at AND newer.day_start<d.day_end AND newer.day_end>d.day_start)`

// DailyTraffic returns intervals intersecting [start,end), ordered chronologically.
func (s *Store) DailyTraffic(ctx context.Context, node string, start, end time.Time) ([]*v1.TelemetryDailyTraffic, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT d.day_start,d.day_end,d.rx_bytes,d.tx_bytes,d.sampled_at,d.revision,d.quality FROM node_daily_traffic d WHERE d.node_id=? AND d.day_start<? AND d.day_end>? AND `+latestDailyTraffic+` ORDER BY d.day_start LIMIT 367`, node, end.UnixMilli(), start.UnixMilli())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]*v1.TelemetryDailyTraffic, 0)
	for rows.Next() {
		var d v1.TelemetryDailyTraffic
		var a, b, c, rx, tx int64
		if err = rows.Scan(&a, &b, &rx, &tx, &c, &d.Revision, &d.Quality); err != nil {
			return nil, err
		}
		d.DayStart = time.UnixMilli(a).UTC()
		d.DayEnd = time.UnixMilli(b).UTC()
		d.SampledAt = time.UnixMilli(c).UTC()
		d.RXBytes = strconv.FormatInt(rx, 10)
		d.TXBytes = strconv.FormatInt(tx, 10)
		out = append(out, &d)
	}
	return out, rows.Err()
}
