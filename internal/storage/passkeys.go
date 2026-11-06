package storage

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	wa "github.com/go-webauthn/webauthn/webauthn"
	"github.com/vioira/viorka/internal/auth"
	"time"
)

func (s *Store) UserByID(ctx context.Context, id string) (auth.User, error) {
	var u auth.User
	e := s.db.QueryRowContext(ctx, `SELECT id,username,password_hash,role FROM users WHERE id=? AND disabled=0`, id).Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role)
	if errors.Is(e, sql.ErrNoRows) {
		e = auth.ErrUnauthorized
	}
	return u, e
}
func (s *Store) Passkeys(ctx context.Context, id string) ([]auth.Passkey, error) {
	rows, e := s.db.QueryContext(ctx, `SELECT id,name,credential,created_at,last_used_at FROM passkeys WHERE user_id=? ORDER BY created_at,id`, id)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []auth.Passkey{}
	for rows.Next() {
		var v auth.Passkey
		var b string
		if e = rows.Scan(&v.ID, &v.Name, &b, &v.CreatedAt, &v.LastUsedAt); e != nil {
			return nil, e
		}
		if e = json.Unmarshal([]byte(b), &v.Credential); e != nil {
			return nil, e
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (s *Store) SavePasskey(ctx context.Context, u auth.User, name string, c wa.Credential) error {
	b, e := json.Marshal(c)
	if e != nil {
		return e
	}
	tx, e := s.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	id := base64.RawURLEncoding.EncodeToString(c.ID)
	r, e := tx.ExecContext(ctx, `INSERT INTO passkeys SELECT ?,?,?,?,?,'' WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=? AND disabled=0) AND (SELECT count(*) FROM passkeys WHERE user_id=?)<20`, id, u.ID, name, string(b), now(), u.ID, u.PasswordHash, u.ID)
	if e != nil {
		return constraint(e)
	}
	n, e := r.RowsAffected()
	if e != nil {
		return e
	}
	if n != 1 {
		return auth.ErrConflict
	}
	if e = audit(ctx, tx, u.ID, "passkey.create", "passkey", id); e != nil {
		return e
	}
	return tx.Commit()
}
func (s *Store) UsePasskey(ctx context.Context, user string, old, c wa.Credential) error {
	b, e := json.Marshal(c)
	if e != nil {
		return e
	}
	previous, e := json.Marshal(old)
	if e != nil {
		return e
	}
	r, e := s.db.ExecContext(ctx, `UPDATE passkeys SET credential=?,last_used_at=? WHERE id=? AND user_id=? AND credential=?`, string(b), now(), base64.RawURLEncoding.EncodeToString(c.ID), user, string(previous))
	if e != nil {
		return e
	}
	n, e := r.RowsAffected()
	if e != nil {
		return e
	}
	if n != 1 {
		return auth.ErrUnauthorized
	}
	return nil
}
func (s *Store) RemovePasskey(ctx context.Context, user, id string) error {
	tx, e := s.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	r, e := tx.ExecContext(ctx, `DELETE FROM passkeys WHERE id=? AND user_id=?`, id, user)
	if e != nil {
		return e
	}
	n, e := r.RowsAffected()
	if e != nil {
		return e
	}
	if n != 1 {
		return auth.ErrNotFound
	}
	if e = audit(ctx, tx, user, "passkey.remove", "passkey", id); e != nil {
		return e
	}
	return tx.Commit()
}
func (s *Store) SaveCeremony(ctx context.Context, hash string, c auth.Ceremony, expires time.Time) error {
	tx, e := s.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(ctx, `DELETE FROM webauthn_challenges WHERE expires_at<=? OR (user_id=? AND kind=? AND binding=?)`, now(), c.UserID, c.Kind, c.Binding); e != nil {
		return e
	}
	r, e := tx.ExecContext(ctx, `INSERT INTO webauthn_challenges SELECT ?,?,?,?,?,? WHERE (SELECT count(*) FROM webauthn_challenges)<500`, hash, c.UserID, c.Kind, c.Binding, c.Data, at(expires))
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
	return tx.Commit()
}
func (s *Store) TakeCeremony(ctx context.Context, hash, kind, binding string) (auth.Ceremony, error) {
	var c auth.Ceremony
	e := s.db.QueryRowContext(ctx, `DELETE FROM webauthn_challenges WHERE token_hash=? AND kind=? AND binding=? AND expires_at>? RETURNING user_id,kind,binding,data`, hash, kind, binding, now()).Scan(&c.UserID, &c.Kind, &c.Binding, &c.Data)
	if errors.Is(e, sql.ErrNoRows) {
		e = auth.ErrUnauthorized
	}
	return c, e
}
