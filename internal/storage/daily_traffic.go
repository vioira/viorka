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
	changed := false
	acks := make([]*v1.TelemetryDailyTrafficAck, 0, len(records))
	for _, d := range records {
		if d == nil || d.Validate() != nil {
			return nil, v1.ErrTelemetryPayload
		}
		rx, _ := strconv.ParseInt(d.RXBytes, 10, 64)
		ty, _ := strconv.ParseInt(d.TXBytes, 10, 64)
		var end, oldRX, oldTX, at, rev, quality int64
		err = tx.QueryRowContext(ctx, `SELECT day_end,rx_bytes,tx_bytes,sampled_at,revision,quality FROM node_daily_traffic WHERE node_id=? AND day_start=?`, node, d.DayStart.UnixMilli()).Scan(&end, &oldRX, &oldTX, &at, &rev, &quality)
		switch {
		case errors.Is(err, sql.ErrNoRows):
			changed = true
			var overlaps int
			if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM node_daily_traffic WHERE node_id=? AND day_start<? AND day_end>?`, node, d.DayEnd.UnixMilli(), d.DayStart.UnixMilli()).Scan(&overlaps); err != nil {
				return nil, err
			}
			if overlaps > 0 {
				return nil, monitoring.ErrDailyTrafficConflict
			}
			_, err = tx.ExecContext(ctx, `INSERT INTO node_daily_traffic(node_id,day_start,day_end,rx_bytes,tx_bytes,sampled_at,revision,quality) VALUES(?,?,?,?,?,?,?,?)`, node, d.DayStart.UnixMilli(), d.DayEnd.UnixMilli(), rx, ty, d.SampledAt.UnixMilli(), d.Revision, d.Quality)
		case err != nil:
			return nil, err
		case d.Revision == uint64(rev):
			if end != d.DayEnd.UnixMilli() || oldRX != rx || oldTX != ty || at != d.SampledAt.UnixMilli() || quality != int64(d.Quality) {
				return nil, monitoring.ErrDailyTrafficConflict
			}
		case d.Revision > uint64(rev):
			changed = true
			if end != d.DayEnd.UnixMilli() || rx < oldRX || ty < oldTX || d.SampledAt.UnixMilli() < at || d.Quality&uint64(quality) != uint64(quality) {
				return nil, monitoring.ErrDailyTrafficConflict
			}
			_, err = tx.ExecContext(ctx, `UPDATE node_daily_traffic SET rx_bytes=?,tx_bytes=?,sampled_at=?,revision=?,quality=? WHERE node_id=? AND day_start=?`, rx, ty, d.SampledAt.UnixMilli(), d.Revision, d.Quality, node, d.DayStart.UnixMilli())
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
		s.events.Publish(realtime.Change{Kind: "history", NodeID: node})
	}
	return acks, nil
}

// DailyTraffic returns intervals intersecting [start,end), ordered chronologically.
func (s *Store) DailyTraffic(ctx context.Context, node string, start, end time.Time) ([]*v1.TelemetryDailyTraffic, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT day_start,day_end,rx_bytes,tx_bytes,sampled_at,revision,quality FROM node_daily_traffic WHERE node_id=? AND day_start<? AND day_end>? ORDER BY day_start LIMIT 367`, node, end.UnixMilli(), start.UnixMilli())
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
