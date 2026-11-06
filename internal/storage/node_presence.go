package storage

import (
	"context"
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
	var seconds int
	if err = tx.QueryRowContext(ctx, `SELECT coalesce((SELECT heartbeat_timeout_seconds FROM system_settings WHERE id=1),300)`).Scan(&seconds); err != nil {
		return err
	}
	cutoff := at(current.Add(-time.Duration(seconds) * time.Second))
	rows, err := tx.QueryContext(ctx, `UPDATE nodes SET state='offline' WHERE id IN (SELECT id FROM nodes WHERE state='online' AND (last_seen_at IS NULL OR last_seen_at<?) ORDER BY last_seen_at,id LIMIT 100) RETURNING id`, cutoff)
	if err != nil {
		return err
	}
	var nodes []string
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		nodes = append(nodes, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	if len(nodes) == 0 {
		return nil
	}
	changes := make([]realtime.Change, 0, len(nodes)+1)
	for _, id := range nodes {
		if _, err = tx.ExecContext(ctx, `INSERT INTO notifications(id,node_id,created_at,message) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM system_settings WHERE id=1 AND alerts=1)`, auth.Random(), id, at(current), "节点已离线，请检查 Agent 与网络连接。"); err != nil {
			return err
		}
		changes = append(changes, realtime.Change{Kind: "node", NodeID: id})
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY created_at DESC,id DESC LIMIT 100)`); err != nil {
		return err
	}
	changes = append(changes, realtime.Change{Kind: "notifications"})
	return s.commitChanges(tx, changes...)
}
