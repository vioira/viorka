package storage

import (
	"context"
	"database/sql"
	"errors"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/realtime"
	"time"
)

// HasUsers includes disabled accounts: startup must never recreate an administrator.
func (s *Store) HasUsers(ctx context.Context) (bool, error) {
	var exists bool
	err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM users)`).Scan(&exists)
	return exists, err
}

func (s *Store) Bootstrap(ctx context.Context, u auth.User) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO users(id,username,password_hash,role,created_at) SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM users)`, u.ID, u.Username, u.PasswordHash, u.Role, now())
	return err
}
func (s *Store) UserByName(ctx context.Context, name string) (auth.User, error) {
	var u auth.User
	err := s.db.QueryRowContext(ctx, `SELECT id,username,password_hash,role FROM users WHERE username=? AND disabled=0`, name).Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role)
	if errors.Is(err, sql.ErrNoRows) {
		err = auth.ErrUnauthorized
	}
	return u, err
}
func (s *Store) SaveSession(ctx context.Context, hash string, v auth.Session) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `DELETE FROM web_sessions WHERE expires_at<=?`, now()); err != nil {
		return err
	}
	m := auth.Metadata(ctx)
	var inserted sql.Result
	if inserted, err = tx.ExecContext(ctx, `INSERT INTO web_sessions SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=? AND (?='' OR role=?) AND disabled=0) AND (?='' OR EXISTS(SELECT 1 FROM passkeys WHERE id=? AND user_id=?))`, hash, v.User.ID, v.CSRF, at(v.ExpiresAt), v.User.ID, v.User.PasswordHash, v.User.Role, v.User.Role, m.PasskeyID, m.PasskeyID, v.User.ID); err != nil {
		return err
	}
	if n, e := inserted.RowsAffected(); e != nil {
		return e
	} else if n != 1 {
		return auth.ErrUnauthorized
	}
	if m.Method == "" {
		m.Method = "password"
	}
	id, ts := auth.Random(), now()
	if _, err = tx.ExecContext(ctx, `INSERT INTO login_history(id,token_hash,user_id,method,source,user_agent,first_ip,latest_ip,created_at,last_active_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`, id, hash, v.User.ID, m.Method, m.Source, m.UserAgent, m.IP, m.IP, ts, ts, at(v.ExpiresAt)); err != nil {
		return err
	}
	if m.IP != "" {
		if _, err = tx.ExecContext(ctx, `INSERT INTO login_ips VALUES(?,?,?,?)`, id, m.IP, ts, ts); err != nil {
			return err
		}
	}
	if err = audit(ctx, tx, v.User.ID, "session.login", "session", id); err != nil {
		return err
	}
	return s.commitChanges(tx, realtime.Change{Kind: "access", UserID: v.User.ID})
}
func (s *Store) Session(ctx context.Context, hash string) (auth.Session, error) {
	var v auth.Session
	var expiry string
	err := s.db.QueryRowContext(ctx, `SELECT u.id,u.username,u.role,s.csrf_token,s.expires_at FROM web_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.disabled=0`, hash, now()).Scan(&v.User.ID, &v.User.Username, &v.User.Role, &v.CSRF, &expiry)
	if errors.Is(err, sql.ErrNoRows) {
		err = auth.ErrUnauthorized
	}
	if err != nil {
		return v, err
	}
	v.ExpiresAt, err = time.Parse(time.RFC3339Nano, expiry)
	return v, err
}
func (s *Store) DeleteSession(ctx context.Context, hash string) error {
	tx, e := s.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(ctx, `UPDATE login_history SET ended_at=?,end_reason='logout' WHERE token_hash=? AND ended_at=''`, now(), hash); e != nil {
		return e
	}
	var user string
	e = tx.QueryRowContext(ctx, `DELETE FROM web_sessions WHERE token_hash=? RETURNING user_id`, hash).Scan(&user)
	if errors.Is(e, sql.ErrNoRows) {
		return tx.Commit()
	}
	if e != nil {
		return e
	}
	if e = audit(ctx, tx, user, "session.logout", "user", user); e != nil {
		return e
	}
	return s.commitChanges(tx, realtime.Change{Kind: "access", UserID: user})
}
func audit(ctx context.Context, tx *sql.Tx, actor, action, kind, id string) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO audit_logs(id,actor_id,action,resource_type,resource_id,created_at) VALUES(?,?,?,?,?,?)`, auth.Random(), actor, action, kind, id, now())
	return err
}
