package storage

import (
	"context"
	"database/sql"
	"errors"
	"github.com/vioira/viorka/internal/auth"
	"modernc.org/sqlite"
	"time"
)

func constraint(err error) error {
	var e *sqlite.Error
	if errors.As(err, &e) && e.Code()&255 == 19 {
		return auth.ErrConflict
	}
	return err
}
func (s *Store) Accounts(ctx context.Context, limit int, after string) ([]auth.Account, error) {
	rows, e := s.db.QueryContext(ctx, `SELECT id,username,email,role,'active','' FROM users WHERE disabled=0 AND id>? UNION ALL SELECT id,username,email,role,'invited',expires_at FROM user_invitations WHERE expires_at>? AND id>? ORDER BY id LIMIT ?`, after, now(), after, limit)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []auth.Account{}
	for rows.Next() {
		var a auth.Account
		if e = rows.Scan(&a.ID, &a.Username, &a.Email, &a.Role, &a.Status, &a.ExpiresAt); e != nil {
			return nil, e
		}
		out = append(out, a)
	}
	return out, rows.Err()
}
func (s *Store) ChangePassword(ctx context.Context, id, old, next, keep string) error {
	tx, e := s.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	r, e := tx.ExecContext(ctx, `UPDATE users SET password_hash=? WHERE id=? AND password_hash=? AND disabled=0`, next, id, old)
	if e != nil {
		return e
	}
	n, _ := r.RowsAffected()
	if n != 1 {
		return auth.ErrConflict
	}
	if _, e = tx.ExecContext(ctx, `DELETE FROM web_sessions WHERE user_id=? AND token_hash!=?`, id, keep); e != nil {
		return e
	}
	if e = audit(ctx, tx, id, "password.change", "user", id); e != nil {
		return e
	}
	return tx.Commit()
}
func (s *Store) LogoutAll(ctx context.Context, id string) error {
	tx, e := s.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(ctx, `DELETE FROM web_sessions WHERE user_id=?`, id); e != nil {
		return e
	}
	if e = audit(ctx, tx, id, "sessions.revoke", "user", id); e != nil {
		return e
	}
	return tx.Commit()
}
func (s *Store) Invite(ctx context.Context, actor string, a auth.Account, hash string, expires time.Time) error {
	tx, e := s.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(ctx, `DELETE FROM user_invitations WHERE expires_at<=?`, now()); e != nil {
		return e
	}
	var n int
	if e = tx.QueryRowContext(ctx, `SELECT count(*) FROM users WHERE username=?`, a.Username).Scan(&n); e != nil {
		return e
	}
	if n != 0 {
		return auth.ErrConflict
	}
	if _, e = tx.ExecContext(ctx, `INSERT INTO user_invitations VALUES(?,?,?,?,?,?,?)`, a.ID, hash, a.Username, a.Email, a.Role, at(expires), actor); e != nil {
		return constraint(e)
	}
	if e = audit(ctx, tx, actor, "user.invite", "invitation", a.ID); e != nil {
		return e
	}
	return tx.Commit()
}
func (s *Store) AcceptInvitation(ctx context.Context, hash string, u auth.User) error {
	tx, e := s.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var a auth.Account
	var actor string
	e = tx.QueryRowContext(ctx, `SELECT id,username,email,role,created_by FROM user_invitations WHERE token_hash=? AND expires_at>?`, hash, now()).Scan(&a.ID, &a.Username, &a.Email, &a.Role, &actor)
	if errors.Is(e, sql.ErrNoRows) {
		return auth.ErrUnauthorized
	}
	if e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, `INSERT INTO users(id,username,email,role,password_hash,created_at) VALUES(?,?,?,?,?,?)`, u.ID, a.Username, a.Email, a.Role, u.PasswordHash, now()); e != nil {
		return constraint(e)
	}
	if _, e = tx.ExecContext(ctx, `DELETE FROM user_invitations WHERE id=?`, a.ID); e != nil {
		return e
	}
	if e = audit(ctx, tx, u.ID, "invitation.accept", "user", u.ID); e != nil {
		return e
	}
	return tx.Commit()
}
func protectAdmin(ctx context.Context, tx *sql.Tx, id string) error {
	var role string
	e := tx.QueryRowContext(ctx, `SELECT role FROM users WHERE id=? AND disabled=0`, id).Scan(&role)
	if errors.Is(e, sql.ErrNoRows) {
		return auth.ErrNotFound
	}
	if e != nil {
		return e
	}
	if role == "admin" {
		var n int
		if e = tx.QueryRowContext(ctx, `SELECT count(*) FROM users WHERE role='admin' AND disabled=0`).Scan(&n); e != nil {
			return e
		}
		if n <= 1 {
			return auth.ErrConflict
		}
	}
	return nil
}
func (s *Store) RemoveAccount(ctx context.Context, actor, id string) error {
	tx, e := s.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	r, e := tx.ExecContext(ctx, `DELETE FROM user_invitations WHERE id=?`, id)
	if e != nil {
		return e
	}
	n, _ := r.RowsAffected()
	if n == 0 {
		if e = protectAdmin(ctx, tx, id); e != nil {
			return e
		}
		if _, e = tx.ExecContext(ctx, `UPDATE users SET disabled=1 WHERE id=?`, id); e != nil {
			return e
		}
		if _, e = tx.ExecContext(ctx, `DELETE FROM web_sessions WHERE user_id=?`, id); e != nil {
			return e
		}
	}
	if e = audit(ctx, tx, actor, "user.remove", "user", id); e != nil {
		return e
	}
	return tx.Commit()
}
func (s *Store) ChangeRole(ctx context.Context, actor, id, role string) error {
	tx, e := s.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if role != "admin" {
		if e = protectAdmin(ctx, tx, id); e != nil {
			return e
		}
	}
	r, e := tx.ExecContext(ctx, `UPDATE users SET role=? WHERE id=? AND disabled=0`, role, id)
	if e != nil {
		return e
	}
	n, _ := r.RowsAffected()
	if n != 1 {
		return auth.ErrNotFound
	}
	if _, e = tx.ExecContext(ctx, `DELETE FROM web_sessions WHERE user_id=?`, id); e != nil {
		return e
	}
	if e = audit(ctx, tx, actor, "user.role", "user", id); e != nil {
		return e
	}
	return tx.Commit()
}
