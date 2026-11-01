package storage

import (
	"context"
	"database/sql"
	"errors"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/realtime"
	"github.com/vioira/viorka/internal/settings"
	"strings"
)

func (s *Store) InitSettings(ctx context.Context, origin string) error {
	_, e := s.db.ExecContext(ctx, `INSERT OR IGNORE INTO system_settings VALUES(1,1,'Viorka',?,'dark',1,1,1,0)`, origin)
	return e
}
func (s *Store) Settings(ctx context.Context) (settings.Config, error) {
	var v settings.Config
	e := s.db.QueryRowContext(ctx, `SELECT revision,panel_name,public_origin,theme,sse,alerts,auto_backup,telemetry FROM system_settings WHERE id=1`).Scan(&v.Revision, &v.PanelName, &v.PublicOrigin, &v.Theme, &v.SSE, &v.Alerts, &v.AutoBackup, &v.Telemetry)
	return v, e
}
func (s *Store) SaveSettings(ctx context.Context, actor string, v settings.Config) error {
	tx, e := s.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	r, e := tx.ExecContext(ctx, `UPDATE system_settings SET revision=revision+1,panel_name=?,public_origin=?,theme=?,sse=?,alerts=?,auto_backup=?,telemetry=? WHERE id=1 AND revision=?`, v.PanelName, v.PublicOrigin, v.Theme, v.SSE, v.Alerts, v.AutoBackup, v.Telemetry, v.Revision)
	if e != nil {
		return e
	}
	n, e := r.RowsAffected()
	if e != nil {
		return e
	}
	if n != 1 {
		return auth.ErrConflict
	}
	if e = audit(ctx, tx, actor, "settings.update", "settings", "1"); e != nil {
		return e
	}
	return s.commitChanges(tx, realtime.Change{Kind: "settings", NodeID: ""})
}
func (s *Store) Notifications(ctx context.Context, user string) ([]settings.Notification, error) {
	rows, e := s.db.QueryContext(ctx, `SELECT n.id,n.node_id,n.created_at,n.message,EXISTS(SELECT 1 FROM notification_reads r WHERE r.notification_id=n.id AND r.user_id=?) FROM notifications n ORDER BY n.created_at DESC,n.id DESC LIMIT 100`, user)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	items := []settings.Notification{}
	for rows.Next() {
		var v settings.Notification
		if e = rows.Scan(&v.ID, &v.NodeID, &v.CreatedAt, &v.Message, &v.Read); e != nil {
			return nil, e
		}
		items = append(items, v)
	}
	return items, rows.Err()
}
func (s *Store) AuditSystem(ctx context.Context, actor, action, id string) error {
	tx, e := s.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var actorID any = actor
	if actor == "" {
		actorID = nil
	}
	if _, e = tx.ExecContext(ctx, `INSERT INTO audit_logs(id,actor_id,action,resource_type,resource_id,created_at) VALUES(?,?,?,'backup',?,?)`, auth.Random(), actorID, action, id, now()); e != nil {
		return e
	}
	return tx.Commit()
}

// A stale heartbeat is always reflected in inventory. The preference only controls notification creation.
func (s *Store) NotifyOffline(ctx context.Context, node string) error {
	tx, e := s.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var state string
	if e = tx.QueryRowContext(ctx, `SELECT state FROM nodes WHERE id=?`, node).Scan(&state); errors.Is(e, sql.ErrNoRows) {
		return nil
	} else if e != nil {
		return e
	}
	if state != "online" {
		return nil
	}
	if _, e = tx.ExecContext(ctx, `UPDATE nodes SET state='offline' WHERE id=?`, node); e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, `INSERT INTO notifications(id,node_id,created_at,message) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM system_settings WHERE id=1 AND alerts=1)`, auth.Random(), node, now(), "节点已离线，请检查 Agent 与网络连接。"); e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, `DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY created_at DESC,id DESC LIMIT 100)`); e != nil {
		return e
	}
	return s.commitChanges(tx, realtime.Change{Kind: "node", NodeID: node}, realtime.Change{Kind: "notifications"})
}

func (s *Store) SetNotificationRead(ctx context.Context, user, id string, read bool) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var exists int
	if err = tx.QueryRowContext(ctx, "SELECT 1 FROM notifications WHERE id=?", id).Scan(&exists); errors.Is(err, sql.ErrNoRows) {
		return auth.ErrNotFound
	} else if err != nil {
		return err
	}
	if read {
		_, err = tx.ExecContext(ctx, "INSERT INTO notification_reads(user_id,notification_id) VALUES(?,?) ON CONFLICT DO NOTHING", user, id)
	} else {
		_, err = tx.ExecContext(ctx, "DELETE FROM notification_reads WHERE user_id=? AND notification_id=?", user, id)
	}
	if err != nil {
		return err
	}
	return s.commitChanges(tx, realtime.Change{Kind: "notifications", UserID: user})
}

// MarkNotificationsRead commits the explicitly selected window atomically.
// Notifications arriving after the user's snapshot remain unread.
func (s *Store) MarkNotificationsRead(ctx context.Context, user string, ids []string) error {
	if len(ids) == 0 || len(ids) > 100 {
		return auth.ErrInvalid
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var count int
	if err = tx.QueryRowContext(ctx, "SELECT count(*) FROM notifications WHERE id IN ("+placeholders+")", args...).Scan(&count); err != nil {
		return err
	}
	if count != len(ids) {
		return auth.ErrNotFound
	}
	values := append([]any{user}, args...)
	if _, err = tx.ExecContext(ctx, "INSERT INTO notification_reads(user_id,notification_id) SELECT ?,id FROM notifications WHERE id IN ("+placeholders+") ON CONFLICT DO NOTHING", values...); err != nil {
		return err
	}
	return s.commitChanges(tx, realtime.Change{Kind: "notifications", UserID: user})
}
