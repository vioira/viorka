package storage

import (
	"context"
	"database/sql"
	"github.com/vioira/viorka/internal/monitoring"
	"github.com/vioira/viorka/internal/realtime"
	v1 "github.com/vioira/viorka/protocol/v1"
	"time"
)

const tcpHistoryDDL = `CREATE TABLE tcp_probe_history (
 node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
 bucket_start INTEGER NOT NULL CHECK(bucket_start>=0 AND bucket_start%60=0),
 sampled_at INTEGER NOT NULL CHECK(sampled_at>=bucket_start*1000 AND sampled_at<(bucket_start+60)*1000),
 target_1 TEXT CHECK(target_1 IS NULL OR length(target_1) BETWEEN 3 AND 259),
 ping_1 REAL CHECK(ping_1 IS NULL OR ping_1=-1 OR ping_1>=0),
 loss_1 INTEGER CHECK(loss_1 IS NULL OR (typeof(loss_1)='integer' AND loss_1 BETWEEN 0 AND 100)),
 target_2 TEXT CHECK(target_2 IS NULL OR length(target_2) BETWEEN 3 AND 259),
 ping_2 REAL CHECK(ping_2 IS NULL OR ping_2=-1 OR ping_2>=0),
 loss_2 INTEGER CHECK(loss_2 IS NULL OR (typeof(loss_2)='integer' AND loss_2 BETWEEN 0 AND 100)),
 target_3 TEXT CHECK(target_3 IS NULL OR length(target_3) BETWEEN 3 AND 259),
 ping_3 REAL CHECK(ping_3 IS NULL OR ping_3=-1 OR ping_3>=0),
 loss_3 INTEGER CHECK(loss_3 IS NULL OR (typeof(loss_3)='integer' AND loss_3 BETWEEN 0 AND 100)),
 CHECK((target_1 IS NULL AND ping_1 IS NULL AND loss_1 IS NULL) OR
       (target_1 IS NOT NULL AND ping_1 IS NOT NULL AND loss_1 IS NOT NULL AND ((ping_1=-1 AND loss_1=100) OR (ping_1>=0 AND loss_1<100)))),
 CHECK((target_2 IS NULL AND ping_2 IS NULL AND loss_2 IS NULL) OR
       (target_2 IS NOT NULL AND ping_2 IS NOT NULL AND loss_2 IS NOT NULL AND ((ping_2=-1 AND loss_2=100) OR (ping_2>=0 AND loss_2<100)))),
 CHECK((target_3 IS NULL AND ping_3 IS NULL AND loss_3 IS NULL) OR
       (target_3 IS NOT NULL AND ping_3 IS NOT NULL AND loss_3 IS NOT NULL AND ((ping_3=-1 AND loss_3=100) OR (ping_3>=0 AND loss_3<100)))),
 CHECK(target_1 IS NOT NULL),
 CHECK(target_3 IS NULL OR target_2 IS NOT NULL),
 CHECK(target_1<>target_2 AND target_1<>target_3 AND target_2<>target_3),
 PRIMARY KEY(node_id,bucket_start)
);
`

func saveTCPHistory(ctx context.Context, tx *sql.Tx, node monitoring.NodeHistory, week int64) ([]realtime.Change, error) {
	changes := []realtime.Change{}
	for _, p := range node.TCPProbes {
		suffix, err := historySuffix(p.BucketStart, week)
		if err != nil {
			return nil, err
		}
		args := []any{node.Node, p.BucketStart, p.SampledAt.UnixMilli()}
		for i := 0; i < 3; i++ {
			if i < len(p.Targets) {
				t := p.Targets[i]
				args = append(args, t.Target, t.Ping, t.Loss)
			} else {
				args = append(args, nil, nil, nil)
			}
		}
		result, err := tx.ExecContext(ctx, `INSERT INTO tcp_probe_history`+suffix+`
   (node_id,bucket_start,sampled_at,target_1,ping_1,loss_1,target_2,ping_2,loss_2,target_3,ping_3,loss_3)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(node_id,bucket_start) DO UPDATE SET
   sampled_at=excluded.sampled_at,
   target_1=excluded.target_1,ping_1=excluded.ping_1,loss_1=excluded.loss_1,
   target_2=excluded.target_2,ping_2=excluded.ping_2,loss_2=excluded.loss_2,
   target_3=excluded.target_3,ping_3=excluded.ping_3,loss_3=excluded.loss_3
   WHERE excluded.sampled_at>tcp_probe_history`+suffix+`.sampled_at`, args...)
		if err != nil {
			return nil, err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return nil, err
		}
		if affected > 0 {
			batch := p.TelemetryTCPProbeBatch
			batch.Targets = make([]*v1.TelemetryTCPProbe, len(p.Targets))
			for i, target := range p.Targets {
				copy := *target
				batch.Targets[i] = &copy
			}
			batch.SampledAt = time.UnixMilli(batch.SampledAt.UnixMilli()).UTC()
			changes = append(changes, realtime.Change{Kind: "tcp_history", NodeID: node.Node, TCPProbe: &batch})
		}
	}
	return changes, nil
}

// Select the latest complete snapshot per display bucket, never average overlapping windows.
func (s *Store) TCPProbeHistory(ctx context.Context, node, target string, start, end, now time.Time, period int) (monitoring.TCPHistory, error) {
	out := monitoring.TCPHistory{Start: start.UTC(), End: end.UTC(), PeriodSeconds: period, Points: []monitoring.TCPHistoryPoint{}}
	if err := monitoring.ValidateTCPHistoryRange(start, end, now, period); err != nil {
		return out, err
	}
	query := `WITH raw AS (
 SELECT * FROM tcp_probe_history WHERE node_id=? AND bucket_start>=? AND bucket_start<=? AND sampled_at>=? AND sampled_at<?
 UNION ALL
 SELECT * FROM tcp_probe_history_old WHERE node_id=? AND bucket_start>=? AND bucket_start<=? AND sampled_at>=? AND sampled_at<?
 ), ranked AS (
 SELECT *,row_number() OVER (PARTITION BY bucket_start/? ORDER BY sampled_at DESC) AS position FROM raw
 WHERE (?='' OR target_1=? OR target_2=? OR target_3=?)
 ) SELECT bucket_start/?*?,sampled_at,target_1,ping_1,loss_1,target_2,ping_2,loss_2,target_3,ping_3,loss_3
 FROM ranked WHERE position=1 ORDER BY bucket_start LIMIT 240`
	args := []any{}
	for range 2 {
		args = append(args, node, start.Unix()/60*60, end.Unix()/60*60, start.UnixMilli(), end.UnixMilli())
	}
	args = append(args, period, target, target, target, target, period, period)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var point monitoring.TCPHistoryPoint
		var sampled int64
		var targets [3]sql.NullString
		var ping [3]sql.NullFloat64
		var loss [3]sql.NullInt64
		if err := rows.Scan(&point.BucketStart, &sampled, &targets[0], &ping[0], &loss[0], &targets[1], &ping[1], &loss[1], &targets[2], &ping[2], &loss[2]); err != nil {
			return out, err
		}
		point.SampledAt = time.UnixMilli(sampled).UTC()
		for i := 0; i < 3; i++ {
			if targets[i].Valid && (target == "" || target == targets[i].String) {
				point.Targets = append(point.Targets, &v1.TelemetryTCPProbe{Target: targets[i].String, Ping: ping[i].Float64, Loss: uint64(loss[i].Int64)})
			}
		}
		out.Points = append(out.Points, point)
	}
	return out, rows.Err()
}
