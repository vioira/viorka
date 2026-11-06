package storage

import (
	"context"
	"database/sql"
	"errors"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/realtime"
)

func (s *Store) TouchSession(ctx context.Context, hash string, m auth.LoginMetadata) error {
	tx, e := s.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	ts := now()
	var id string
	e = tx.QueryRowContext(ctx, `SELECT h.id FROM login_history h JOIN web_sessions s ON s.token_hash=h.token_hash WHERE h.token_hash=? AND s.expires_at>? AND h.ended_at=''`, hash, ts).Scan(&id)
	if errors.Is(e, sql.ErrNoRows) {
		return nil
	}
	if e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, `UPDATE login_history SET last_active_at=?,latest_ip=CASE WHEN ?='' THEN latest_ip ELSE ? END WHERE id=?`, ts, m.IP, m.IP, id); e != nil {
		return e
	}
	if m.IP != "" {
		if _, e = tx.ExecContext(ctx, `INSERT INTO login_ips VALUES(?,?,?,?) ON CONFLICT(session_id,ip) DO UPDATE SET last_used_at=excluded.last_used_at`, id, m.IP, ts, ts); e != nil {
			return e
		}
	}
	return tx.Commit()
}
func (s *Store) SessionHistory(ctx context.Context, user, hash, after string, limit int) ([]auth.SessionRecord, error) {
	if limit < 1 || limit > 100 {
		return nil, auth.ErrInvalid
	}
	cursorTime := "9999"
	if after != "" {
		if e := s.db.QueryRowContext(ctx, `SELECT created_at FROM login_history WHERE id=? AND user_id=?`, after, user).Scan(&cursorTime); errors.Is(e, sql.ErrNoRows) {
			return nil, auth.ErrInvalid
		} else if e != nil {
			return nil, e
		}
	}
	rows, e := s.db.QueryContext(ctx, `SELECT h.id,h.user_id,u.username,h.method,h.source,h.user_agent,h.first_ip,h.latest_ip,h.created_at,h.last_active_at,h.expires_at,h.ended_at,h.end_reason,h.token_hash=? FROM login_history h JOIN users u ON u.id=h.user_id WHERE h.user_id=? AND (h.created_at<? OR (h.created_at=? AND h.id<?)) ORDER BY h.created_at DESC,h.id DESC LIMIT ?`, hash, user, cursorTime, cursorTime, after, limit)
	if e != nil {
		return nil, e
	}
	out := []auth.SessionRecord{}
	for rows.Next() {
		var v auth.SessionRecord
		if e = rows.Scan(&v.ID, &v.UserID, &v.Username, &v.Method, &v.Source, &v.UserAgent, &v.FirstIP, &v.LatestIP, &v.CreatedAt, &v.LastActiveAt, &v.ExpiresAt, &v.EndedAt, &v.EndReason, &v.Current); e != nil {
			rows.Close()
			return nil, e
		}
		if v.EndedAt == "" && v.ExpiresAt <= now() {
			v.EndedAt = v.ExpiresAt
			v.EndReason = "expired"
		}
		out = append(out, v)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	for i := range out {
		out[i].IPs = []auth.SessionIP{}
		ips, e := s.db.QueryContext(ctx, `SELECT ip,first_used_at,last_used_at FROM login_ips WHERE session_id=? ORDER BY last_used_at DESC,ip LIMIT 100`, out[i].ID)
		if e != nil {
			return nil, e
		}
		for ips.Next() {
			var ip auth.SessionIP
			if e = ips.Scan(&ip.IP, &ip.FirstUsedAt, &ip.LastUsedAt); e != nil {
				ips.Close()
				return nil, e
			}
			out[i].IPs = append(out[i].IPs, ip)
		}
		e = ips.Err()
		ips.Close()
		if e != nil {
			return nil, e
		}
	}
	return out, nil
}
func (s *Store) RevokeSession(ctx context.Context, user, id string) error {
	tx, e := s.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var hash string
	e = tx.QueryRowContext(ctx, `SELECT token_hash FROM login_history WHERE id=? AND user_id=?`, id, user).Scan(&hash)
	if errors.Is(e, sql.ErrNoRows) {
		return auth.ErrNotFound
	}
	if e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, `DELETE FROM web_sessions WHERE token_hash=?`, hash); e != nil {
		return e
	}
	if e = audit(ctx, tx, user, "session.revoke", "session", id); e != nil {
		return e
	}
	return s.commitChanges(tx, realtime.Change{Kind: "access", UserID: user})
}
