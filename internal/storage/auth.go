package storage

import (
	"context"
	"database/sql"
	"errors"
	"github.com/vioira/viorka/internal/auth"
	"time"
)

func (s *Store) Bootstrap(ctx context.Context, u auth.User) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO users(id,username,password_hash,role,created_at) SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM users)`, u.ID, u.Username, u.PasswordHash, u.Role, now())
	return err
}
func (s *Store) UserByName(ctx context.Context, name string) (auth.User, error) {
	var u auth.User
	err := s.db.QueryRowContext(ctx, `SELECT id,username,password_hash,role FROM users WHERE username=?`, name).Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role)
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
	if _, err = tx.ExecContext(ctx, `DELETE FROM web_sessions WHERE expires_at<=? OR user_id=?`, now(), v.User.ID); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO web_sessions VALUES(?,?,?,?)`, hash, v.User.ID, v.CSRF, at(v.ExpiresAt)); err != nil {
		return err
	}
	return tx.Commit()
}
func (s *Store) Session(ctx context.Context, hash string) (auth.Session, error) {
	var v auth.Session
	var expiry string
	err := s.db.QueryRowContext(ctx, `SELECT u.id,u.username,u.role,s.csrf_token,s.expires_at FROM web_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`, hash, now()).Scan(&v.User.ID, &v.User.Username, &v.User.Role, &v.CSRF, &expiry)
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
	_, err := s.db.ExecContext(ctx, `DELETE FROM web_sessions WHERE token_hash=?`, hash)
	return err
}
func audit(ctx context.Context, tx *sql.Tx, actor, action, kind, id string) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO audit_logs(id,actor_id,action,resource_type,resource_id,created_at) VALUES(?,?,?,?,?,?)`, auth.Random(), actor, action, kind, id, now())
	return err
}
