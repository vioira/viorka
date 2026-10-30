package storage

import (
	"context"
	"database/sql"
	"errors"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/settings"
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
	return tx.Commit()
}
func (s *Store) Notifications(ctx context.Context) ([]settings.Notification, error) {
	rows, e := s.db.QueryContext(ctx, `SELECT id,node_id,created_at,message FROM notifications ORDER BY created_at DESC,id DESC LIMIT 100`)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	items := []settings.Notification{}
	for rows.Next() {
		var v settings.Notification
		if e = rows.Scan(&v.ID, &v.NodeID, &v.CreatedAt, &v.Message); e != nil {
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
	return tx.Commit()
}
