package storage

import (
	"context"
	"database/sql"
	"errors"
	auditlog "github.com/vioira/viorka/internal/audit"
	"github.com/vioira/viorka/internal/auth"
)

func (s *Store) AuditLogs(ctx context.Context, limit int, after, kind string) ([]auditlog.Record, error) {
	if limit < 1 || limit > 101 || (kind != "all" && kind != "user" && kind != "system") {
		return nil, auth.ErrInvalid
	}
	var timestamp string
	if after != "" {
		if err := s.db.QueryRowContext(ctx, `SELECT created_at FROM audit_logs WHERE id=?`, after).Scan(&timestamp); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, auth.ErrInvalid
			}
			return nil, err
		}
	}
	rows, err := s.db.QueryContext(ctx, `SELECT a.id, COALESCE(a.actor_id,''), COALESCE(u.username,a.actor_id,''), a.action, a.resource_type, COALESCE(a.resource_id,''), COALESCE(a.source_ip,''), a.created_at
 FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id
 WHERE (?='all' OR (?='system' AND a.actor_id IS NULL) OR (?='user' AND a.actor_id IS NOT NULL))
 AND (?='' OR (a.created_at,a.id)<(?,?)) ORDER BY a.created_at DESC,a.id DESC LIMIT ?`, kind, kind, kind, after, timestamp, after, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]auditlog.Record, 0)
	for rows.Next() {
		var v auditlog.Record
		if err := rows.Scan(&v.ID, &v.ActorID, &v.Actor, &v.Action, &v.ResourceType, &v.ResourceID, &v.SourceIP, &v.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, v)
	}
	return items, rows.Err()
}
