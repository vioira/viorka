package storage

import (
	"context"
	"database/sql"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/realtime"
)

// ExpireOffline applies the same heartbeat window to connected and disconnected
// nodes. Selection, state changes and notifications share a transaction so a
// concurrent heartbeat or settings edit cannot invalidate the decision.
func (s *Store) ExpireOffline(ctx context.Context, current time.Time) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var seconds, minutes int
	query := "SELECT heartbeat_timeout_seconds,offline_alert_minutes FROM system_settings WHERE id=1"
	if s.postgres {
		query += " FOR SHARE"
	}
	if err = tx.QueryRowContext(ctx, query).Scan(&seconds, &minutes); err == sql.ErrNoRows {
		seconds = 60
	} else if err != nil {
		return err
	}
	var since any
	if minutes > 0 {
		since = at(current)
	}
	cutoff := at(current.Add(-time.Duration(seconds) * time.Second))
	nodes, err := updatePresence(ctx, tx, `UPDATE nodes SET state='offline',offline_alert_since=?
      WHERE state='online' AND (last_seen_at IS NULL OR last_seen_at<?) AND id IN
      (SELECT id FROM nodes WHERE state='online' AND (last_seen_at IS NULL OR last_seen_at<?) ORDER BY last_seen_at,id LIMIT 100)
      RETURNING id`, since, cutoff, cutoff)
	if err != nil {
		return err
	}
	var changes []realtime.Change
	for _, id := range nodes {
		changes = append(changes, realtime.Change{Kind: "node", NodeID: id})
	}
	if minutes > 0 {
		due := at(current.Add(-time.Duration(minutes) * time.Minute))
		ids, err := updatePresence(ctx, tx, `UPDATE nodes SET offline_alert_since=NULL
          WHERE state='offline' AND offline_alert_since<=? AND id IN
          (SELECT id FROM nodes WHERE state='offline' AND offline_alert_since<=? ORDER BY offline_alert_since,id LIMIT 100)
          RETURNING id`, due, due)
		if err != nil {
			return err
		}
		for _, id := range ids {
			if _, err = tx.ExecContext(ctx, `INSERT INTO notifications(id,node_id,created_at,message) VALUES(?,?,?,?)`, auth.Random(), id, at(current), "节点已离线，请检查 Agent 与网络连接。"); err != nil {
				return err
			}
		}
		if len(ids) > 0 {
			if _, err = tx.ExecContext(ctx, `DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY created_at DESC,id DESC LIMIT 100)`); err != nil {
				return err
			}
			changes = append(changes, realtime.Change{Kind: "notifications"})
		}
	}
	return s.commitChanges(tx, changes...)
}

func updatePresence(ctx context.Context, tx *sql.Tx, query string, args ...any) ([]string, error) {
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
