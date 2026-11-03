package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/vioira/viorka/internal/monitoring"
	"github.com/vioira/viorka/internal/realtime"
)

var ErrHistoryClockRollback = monitoring.ErrPartitionClockRollback
var ErrHistoryOutsidePartitions = errors.New("history bucket outside retained partitions")
var ErrStaleHistorySnapshot = errors.New("history checkpoint would regress")

const historyTransactionBytes = 8 << 20

func historyWeek(t time.Time) int64 {
	t = t.UTC()
	day := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
	return day.AddDate(0, 0, -int(day.Weekday())).Unix()
}

// RotateTelemetryHistory is also called inside every save transaction. Running
// it on startup/maintenance makes missed weeks catch up without incoming data.
func (s *Store) RotateTelemetryHistory(ctx context.Context, now time.Time) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, rollback, err := rotateHistory(ctx, tx, now)
	if err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	if rollback {
		return ErrHistoryClockRollback
	}
	return nil
}
func rotateHistory(ctx context.Context, tx *sql.Tx, now time.Time) (int64, bool, error) {
	week := historyWeek(now)
	var current int64
	err := tx.QueryRowContext(ctx, `SELECT week_start FROM metric_history_partitions WHERE role='current'`).Scan(&current)
	if errors.Is(err, sql.ErrNoRows) {
		_, err = tx.ExecContext(ctx, `INSERT INTO metric_history_partitions(role,week_start,schema_version) VALUES('current',?,1),('previous',?,1)`, week, week-604800)
		return week, false, err
	}
	if err != nil {
		return 0, false, err
	}
	var previous int64
	if err = tx.QueryRowContext(ctx, `SELECT week_start FROM metric_history_partitions WHERE role='previous'`).Scan(&previous); err != nil {
		return 0, false, err
	}
	if previous != current-604800 {
		return 0, false, errors.New("inconsistent history partition metadata")
	}
	if week <= current {
		return current, week < current, nil
	}
	if week-current == 604800 {
		// SQLite rewrites child FKs on parent rename. Drop oldest children first and
		// remove the old index name before creating a fresh current partition.
		for _, q := range []string{
			`DROP TABLE metrics_history_old`,
			`ALTER TABLE metrics_history RENAME TO metrics_history_old`,
			`DROP INDEX idx_metrics_history_time`,
			`CREATE INDEX idx_metrics_history_old_time ON metrics_history_old(bucket_start)`, historyCurrentDDL,
		} {
			if _, err = tx.ExecContext(ctx, q); err != nil {
				return 0, false, fmt.Errorf("rotate history: %w", err)
			}
		}
	} else {
		// Both physical partitions are older than the previous week; never relabel
		// multi-week-old observations as last week's data.
		for _, table := range []string{"metrics_history_old", "metrics_history"} {
			if _, err = tx.ExecContext(ctx, `DELETE FROM `+table); err != nil {
				return 0, false, err
			}
		}
	}
	_, err = tx.ExecContext(ctx, `UPDATE metric_history_partitions SET week_start=CASE role WHEN 'current' THEN ? ELSE ? END`, week, week-604800)
	return week, false, err
}
func historySuffix(start, week int64) (string, error) {
	if start >= week && start < week+604800 {
		return "", nil
	}
	if start >= week-604800 && start < week {
		return "_old", nil
	}
	return "", ErrHistoryOutsidePartitions
}

// SaveTelemetryHistory persists complete node snapshots and their watermarks in
// one transaction. No committed watermark can get ahead of its statistics.
func (s *Store) SaveTelemetryHistory(ctx context.Context, nodes []monitoring.NodeHistory, now time.Time) error {
	if len(nodes) > monitoring.MaxNodes {
		return errors.New("history node limit exceeded")
	}
	count, encoded := 0, 0
	seen := map[string]bool{}
	for _, node := range nodes {
		if node.Node == "" || len(node.Node) > 128 || seen[node.Node] || len(node.Checkpoints) > 16 || len(node.Addresses) > 2 {
			return errors.New("invalid history node snapshot")
		}
		keys := map[string]bool{}
		runs := map[string]bool{}
		for _, c := range node.Checkpoints {
			key := c.RunID + "/" + c.Group
			if keys[key] {
				return errors.New("duplicate history checkpoint")
			}
			keys[key] = true
			runs[c.RunID] = true
		}
		if len(runs) > 4 {
			return errors.New("history run limit exceeded")
		}
		seen[node.Node] = true
		count += len(node.Buckets)
		data, err := json.Marshal(node)
		if err != nil {
			return err
		}
		encoded += len(data)
		if len(data) > 4<<20 || encoded > historyTransactionBytes || count > 512 {
			return errors.New("history transaction budget exceeded")
		}
		starts := map[int64]bool{}
		for _, b := range node.Buckets {
			if b.Node != node.Node || starts[b.Start] {
				return errors.New("invalid history bucket")
			}
			starts[b.Start] = true
		}
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	week, _, err := rotateHistory(ctx, tx, now)
	if err != nil {
		return err
	}
	published := []string{}
	for _, node := range nodes {
		var exists int
		if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM nodes WHERE id=?`, node.Node).Scan(&exists); err != nil {
			return err
		}
		if exists == 0 {
			continue
		} // deletion wins; delayed flush cannot resurrect it
		for _, c := range node.Checkpoints {
			var seq uint64
			err = tx.QueryRowContext(ctx, `SELECT committed_sequence FROM metric_ingest_checkpoints WHERE node_id=? AND run_id=? AND metric_group=?`, node.Node, c.RunID, c.Group).Scan(&seq)
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return err
			}
			if err == nil && seq > c.Sequence {
				return ErrStaleHistorySnapshot
			}
		}
		for i := range node.Buckets {
			b := &node.Buckets[i]
			b.UpdatedAt = now.UnixMilli()
			suffix, e := historySuffix(b.Start, week)
			if e != nil {
				return e
			}
			_, err = tx.ExecContext(ctx, `INSERT INTO metrics_history`+suffix+` (`+historyColumns+`) VALUES (`+historyPlaceholders+`) ON CONFLICT(node_id,bucket_start) DO UPDATE SET `+historyUpdates, historyValues(b)...)
			if err != nil {
				return fmt.Errorf("save history bucket: %w", err)
			}
		}

		existing, e := tx.QueryContext(ctx, `SELECT run_id,metric_group FROM metric_ingest_checkpoints WHERE node_id=?`, node.Node)
		if e != nil {
			return e
		}
		type checkpointKey struct{ run, group string }
		obsolete := []checkpointKey{}
		for existing.Next() {
			var k checkpointKey
			if e = existing.Scan(&k.run, &k.group); e != nil {
				existing.Close()
				return e
			}
			keep := false
			for _, c := range node.Checkpoints {
				if c.RunID == k.run && c.Group == k.group {
					keep = true
					break
				}
			}
			if !keep {
				obsolete = append(obsolete, k)
			}
		}
		e = existing.Err()
		existing.Close()
		if e != nil {
			return e
		}
		for _, k := range obsolete {
			if _, e = tx.ExecContext(ctx, `DELETE FROM metric_ingest_checkpoints WHERE node_id=? AND run_id=? AND metric_group=?`, node.Node, k.run, k.group); e != nil {
				return e
			}
		}
		for _, c := range node.Checkpoints {
			_, err = tx.ExecContext(ctx, `INSERT INTO metric_ingest_checkpoints VALUES(?,?,?,?,?) ON CONFLICT(node_id,run_id,metric_group) DO UPDATE SET committed_sequence=excluded.committed_sequence,sampled_at=excluded.sampled_at`, node.Node, c.RunID, c.Group, c.Sequence, c.SampledAt)
			if err != nil {
				return err
			}
		}
		if v := node.System; v != nil {
			_, err = tx.ExecContext(ctx, `INSERT INTO node_system_info VALUES(?,?,?,?,?,?) ON CONFLICT(node_id) DO UPDATE SET os_id=excluded.os_id,os_name=excluded.os_name,os_version=excluded.os_version,sampled_at=excluded.sampled_at,unavailable=excluded.unavailable WHERE excluded.sampled_at>=node_system_info.sampled_at`, node.Node, v.OSID, v.OSName, v.OSVersion, v.SampledAt, v.Unavailable)
			if err != nil {
				return err
			}
		}
		for _, v := range node.Addresses {
			_, err = tx.ExecContext(ctx, `INSERT INTO node_public_addresses VALUES(?,?,?,?,?) ON CONFLICT(node_id,family) DO UPDATE SET address=excluded.address,sampled_at=excluded.sampled_at,unavailable=excluded.unavailable WHERE excluded.sampled_at>=node_public_addresses.sampled_at`, node.Node, v.Family, v.Address, v.SampledAt, v.Unavailable)
			if err != nil {
				return err
			}
		}
		published = append(published, node.Node)
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	for _, node := range published {
		s.events.Publish(realtime.Change{Kind: "history", NodeID: node})
	}
	return nil
}

type historyReader interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func (s *Store) loadHistoryBuckets(ctx context.Context, reader historyReader, node string, start, end int64) ([]monitoring.Bucket, error) {
	out := []monitoring.Bucket{}
	budget := 64 << 20
	for _, suffix := range []string{"_old", ""} {
		query := ` FROM metrics_history` + suffix + ` WHERE bucket_start>=? AND bucket_start<?`
		args := []any{start, end}
		if node != "" {
			query += ` AND node_id=?`
			args = append(args, node)
		}
		rows, err := reader.QueryContext(ctx, `SELECT `+historyColumns+query+` ORDER BY node_id,bucket_start LIMIT 32769`, args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var b monitoring.Bucket
			if err = rows.Scan(historyTargets(&b)...); err != nil {
				rows.Close()
				return nil, err
			}
			if len(out) >= 32768 {
				rows.Close()
				return nil, errors.New("history recovery bucket limit exceeded")
			}
			budget -= 2048 + 2*(len(b.Node)+len(b.FilterRevision)+len(b.TrafficFilterRevision))
			if budget < 0 {
				rows.Close()
				return nil, errors.New("history read memory budget exceeded")
			}
			out = append(out, b)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Node == out[j].Node {
			return out[i].Start < out[j].Start
		}
		return out[i].Node < out[j].Node
	})
	return out, nil
}

// TelemetryHistory reads only new typed tables. Complete base buckets beginning
// within [start,end) are returned/merged; no invented boundary interpolation.
func (s *Store) TelemetryHistory(ctx context.Context, node string, start, end, now time.Time, period int) ([]monitoring.Bucket, error) {
	if node == "" || !end.After(start) || end.Sub(start) > 168*time.Hour || start.Before(now.Add(-168*time.Hour)) || end.After(now.Add(300*time.Second)) {
		return nil, errors.New("invalid telemetry history range")
	}
	switch period {
	case 30, 180, 720, 1440, 3600:
	default:
		return nil, errors.New("invalid telemetry history resolution")
	}
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	out := []monitoring.Bucket{}
	// Stream bounded base-bucket chunks under the same SQLite read snapshot.
	// A seven-day query must not allocate all base buckets at once.
	from := start.Unix()
	if start.Nanosecond() != 0 {
		from++
	}
	endSecond := end.Unix()
	if end.Nanosecond() != 0 {
		endSecond++
	}
	for from < endSecond {
		until := min(endSecond, from+128*30)
		rows, err := s.loadHistoryBuckets(ctx, tx, node, from, until)
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			at := row.Start / int64(period) * int64(period)
			if len(out) == 0 || out[len(out)-1].Start != at {
				out = append(out, monitoring.Bucket{Node: node, Start: at})
			}
			out[len(out)-1].Merge(row)
		}
		if historyReadSize(out) > 32<<20 {
			return nil, errors.New("history response budget exceeded")
		}
		from = until
	}
	return out, nil
}

// RestoreTelemetryHistory returns committed buckets, checkpoints and assets
// together. The single Panel instance is the only owner of their mutation.
func (s *Store) RestoreTelemetryHistory(ctx context.Context, now time.Time) ([]monitoring.NodeHistory, error) {
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	buckets, err := s.loadHistoryBuckets(ctx, tx, "", now.Add(-10*time.Minute).Unix(), now.Add(301*time.Second).Unix())
	if err != nil {
		return nil, err
	}
	nodes := map[string]*monitoring.NodeHistory{}
	get := func(id string) (*monitoring.NodeHistory, error) {
		if n := nodes[id]; n != nil {
			return n, nil
		}
		if len(nodes) >= monitoring.MaxNodes {
			return nil, errors.New("history node limit exceeded")
		}
		n := &monitoring.NodeHistory{Node: id}
		nodes[id] = n
		return n, nil
	}
	for _, b := range buckets {
		n, e := get(b.Node)
		if e != nil {
			return nil, e
		}
		n.Buckets = append(n.Buckets, b)
	}
	rows, err := tx.QueryContext(ctx, `SELECT node_id,run_id,metric_group,committed_sequence,sampled_at FROM metric_ingest_checkpoints`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id string
		var c monitoring.Checkpoint
		if err = rows.Scan(&id, &c.RunID, &c.Group, &c.Sequence, &c.SampledAt); err != nil {
			rows.Close()
			return nil, err
		}
		n, e := get(id)
		if e != nil {
			rows.Close()
			return nil, e
		}
		if len(n.Checkpoints) >= 16 {
			rows.Close()
			return nil, errors.New("checkpoint limit exceeded")
		}
		n.Checkpoints = append(n.Checkpoints, c)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	// Assets do not expire with history; load only these bounded active nodes.
	for _, n := range nodes {
		var v monitoring.SystemSnapshot
		err = tx.QueryRowContext(ctx, `SELECT os_id,os_name,os_version,sampled_at,unavailable FROM node_system_info WHERE node_id=?`, n.Node).Scan(&v.OSID, &v.OSName, &v.OSVersion, &v.SampledAt, &v.Unavailable)
		if err == nil {
			n.System = &v
		} else if !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		rows, err = tx.QueryContext(ctx, `SELECT family,address,sampled_at,unavailable FROM node_public_addresses WHERE node_id=?`, n.Node)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var a monitoring.AddressSnapshot
			if err = rows.Scan(&a.Family, &a.Address, &a.SampledAt, &a.Unavailable); err != nil {
				rows.Close()
				return nil, err
			}
			n.Addresses = append(n.Addresses, a)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
	}
	out := make([]monitoring.NodeHistory, 0, len(nodes))
	size := 0
	for _, n := range nodes {
		b, e := json.Marshal(n)
		if e != nil {
			return nil, e
		}
		size += len(b)
		if size > 64<<20 {
			return nil, errors.New("history restore memory budget exceeded")
		}
		out = append(out, *n)
	}
	return out, nil
}

func historyReadSize(rows []monitoring.Bucket) int {
	size := 0
	for _, b := range rows {
		size += 2048 + 2*(len(b.Node)+len(b.FilterRevision)+len(b.TrafficFilterRevision))
	}
	return size
}
