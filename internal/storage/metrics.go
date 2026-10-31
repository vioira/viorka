package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/vioira/viorka/internal/monitoring"
	"sort"
	"time"
)

func (s *Store) SaveRollups(ctx context.Context, rows []monitoring.Rollup) error {
	if len(rows) > 512 {
		return fmt.Errorf("too many metric buckets")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, row := range rows {
		b, err := json.Marshal(row.Stats)
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO metric_rollups(node_id,bucket_start,period_seconds,stats_json,last_sample_at) SELECT ?,?,60,?,? WHERE EXISTS(SELECT 1 FROM nodes WHERE id=?) ON CONFLICT(node_id,bucket_start,period_seconds) DO UPDATE SET stats_json=excluded.stats_json,last_sample_at=excluded.last_sample_at WHERE metric_rollups.last_sample_at IS NULL OR excluded.last_sample_at>=metric_rollups.last_sample_at`, row.Node, at(row.At), string(b), at(row.LastSample), row.Node)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}
func (s *Store) readRollups(ctx context.Context, query string, args ...any) ([]monitoring.Rollup, error) {
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []monitoring.Rollup{}
	for rows.Next() {
		var row monitoring.Rollup
		var bucket, last, data string
		if err = rows.Scan(&row.Node, &bucket, &last, &data); err != nil {
			return nil, err
		}
		if row.At, err = time.Parse(time.RFC3339Nano, bucket); err != nil {
			return nil, err
		}
		if row.LastSample, err = time.Parse(time.RFC3339Nano, last); err != nil {
			return nil, err
		}
		if err = json.Unmarshal([]byte(data), &row.Stats); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}
func (s *Store) RecentRollups(ctx context.Context, since time.Time) ([]monitoring.Rollup, error) {
	return s.readRollups(ctx, `SELECT node_id,bucket_start,last_sample_at,stats_json FROM metric_rollups WHERE bucket_start>=? AND stats_json IS NOT NULL ORDER BY bucket_start DESC LIMIT 12288`, at(since))
}
func (s *Store) MetricHistory(ctx context.Context, id string, start, end time.Time, period int) (monitoring.History, error) {
	out := monitoring.History{PeriodSeconds: period, Points: []monitoring.Rollup{}}
	if !end.After(start) || end.Sub(start) > 7*24*time.Hour || (period != 60 && period != 300 && period != 900) {
		return out, fmt.Errorf("invalid history range")
	}
	rows, err := s.readRollups(ctx, `SELECT node_id,bucket_start,last_sample_at,stats_json FROM metric_rollups WHERE node_id=? AND bucket_start>=? AND bucket_start<? AND period_seconds=60 AND stats_json IS NOT NULL ORDER BY bucket_start LIMIT 10081`, id, at(start), at(end))
	if err != nil {
		return out, err
	}
	buckets := map[int64]monitoring.Rollup{}
	for _, row := range rows {
		k := row.At.Unix() / int64(period) * int64(period)
		b := buckets[k]
		if b.Stats == nil {
			b = monitoring.Rollup{At: time.Unix(k, 0).UTC(), Stats: map[string]monitoring.Statistic{}}
		}
		for key, v := range row.Stats {
			b.Stats[key] = b.Stats[key].Merge(v)
		}
		if row.LastSample.After(b.LastSample) {
			b.LastSample = row.LastSample
		}
		buckets[k] = b
	}
	for _, b := range buckets {
		out.Points = append(out.Points, b)
	}
	sort.Slice(out.Points, func(i, j int) bool { return out.Points[i].At.Before(out.Points[j].At) })
	return out, nil
}
func (s *Store) PruneMetrics(ctx context.Context, before time.Time) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM metric_rollups WHERE rowid IN (SELECT rowid FROM metric_rollups WHERE bucket_start<? ORDER BY bucket_start LIMIT 2000)`, at(before))
	return err
}
