package storage

import (
	"context"
	"database/sql"
	"errors"
	"github.com/vioira/viorka/internal/auth"
	"time"
)

func (s *Store) CreateEnrollment(ctx context.Context, actor, name, kind, hash string, v auth.Enrollment) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `INSERT INTO enrollment_tokens(id,token_hash,name,kind,expires_at,created_by) VALUES(?,?,?,?,?,?)`, v.ID, hash, name, kind, at(v.ExpiresAt), actor); err != nil {
		return err
	}
	if err = audit(ctx, tx, actor, "enrollment.create", "enrollment", v.ID); err != nil {
		return err
	}
	return tx.Commit()
}
func (s *Store) RevokeEnrollment(ctx context.Context, actor, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	r, err := tx.ExecContext(ctx, `UPDATE enrollment_tokens SET revoked_at=? WHERE id=?`, now(), id)
	if err != nil {
		return err
	}
	n, _ := r.RowsAffected()
	if n == 0 {
		return auth.ErrNotFound
	}
	if err = audit(ctx, tx, actor, "enrollment.revoke", "enrollment", id); err != nil {
		return err
	}
	return tx.Commit()
}
func (s *Store) Enroll(ctx context.Context, hash, key, id string) (string, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	var name, kind string
	err = tx.QueryRowContext(ctx, `UPDATE enrollment_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>? RETURNING name,kind`, now(), hash, now()).Scan(&name, &kind)
	if errors.Is(err, sql.ErrNoRows) {
		// Recover a lost enrollment response only for the exact token/key binding.
		err = tx.QueryRowContext(ctx, `SELECT t.node_id FROM enrollment_tokens t JOIN agent_credentials c ON c.node_id=t.node_id WHERE t.token_hash=? AND t.expires_at>? AND t.revoked_at IS NULL AND c.public_key=? AND c.status='active'`, hash, now(), key).Scan(&id)
		if errors.Is(err, sql.ErrNoRows) {
			return "", auth.ErrUnauthorized
		}
		if err != nil {
			return "", err
		}
		return id, tx.Commit()
	}
	if err != nil {
		return "", err
	}
	var existing int
	if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM agent_credentials WHERE public_key=?`, key).Scan(&existing); err != nil {
		return "", err
	}
	if existing > 0 {
		return "", auth.ErrConflict
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO nodes(id,name,kind,created_at) VALUES(?,?,?,?)`, id, name, kind, now()); err != nil {
		return "", err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO agent_credentials(id,node_id,public_key,status,created_at) VALUES(?,?,?,'active',?)`, auth.Random(), id, key, now()); err != nil {
		return "", err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE enrollment_tokens SET node_id=? WHERE token_hash=?`, id, hash); err != nil {
		return "", err
	}
	return id, tx.Commit()
}
func (s *Store) AgentKey(ctx context.Context, id string) (string, error) {
	var key string
	err := s.db.QueryRowContext(ctx, `SELECT c.public_key FROM agent_credentials c JOIN nodes n ON n.id=c.node_id WHERE c.node_id=? AND c.status='active' AND n.state!='disabled'`, id).Scan(&key)
	if errors.Is(err, sql.ErrNoRows) {
		err = auth.ErrUnauthorized
	}
	return key, err
}
func (s *Store) SaveChallenge(ctx context.Context, node string, c auth.Challenge) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `DELETE FROM agent_challenges WHERE expires_at<=? OR node_id=?`, now(), node); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO agent_challenges VALUES(?,?,?,?)`, c.ID, node, c.Message, at(c.ExpiresAt)); err != nil {
		return err
	}
	return tx.Commit()
}
func (s *Store) ConsumeChallenge(ctx context.Context, id string, verify func(string, string) bool, hash string, expiry time.Time) (string, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	var node, msg, key string
	err = tx.QueryRowContext(ctx, `SELECT c.node_id,c.message,k.public_key FROM agent_challenges c JOIN agent_credentials k ON k.node_id=c.node_id JOIN nodes n ON n.id=c.node_id WHERE c.id=? AND c.expires_at>? AND k.status='active' AND n.state!='disabled'`, id, now()).Scan(&node, &msg, &key)
	if errors.Is(err, sql.ErrNoRows) {
		return "", auth.ErrUnauthorized
	}
	if err != nil {
		return "", err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM agent_challenges WHERE id=?`, id); err != nil {
		return "", err
	}
	if !verify(key, msg) {
		if err = tx.Commit(); err != nil {
			return "", err
		}
		return "", auth.ErrUnauthorized
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM agent_sessions WHERE expires_at<=? OR node_id=?`, now(), node); err != nil {
		return "", err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO agent_sessions VALUES(?,?,?)`, hash, node, at(expiry)); err != nil {
		return "", err
	}
	return node, tx.Commit()
}
func (s *Store) AgentSession(ctx context.Context, hash string) (string, time.Time, error) {
	var node, expiry string
	err := s.db.QueryRowContext(ctx, `SELECT s.node_id,s.expires_at FROM agent_sessions s JOIN nodes n ON n.id=s.node_id JOIN agent_credentials c ON c.node_id=n.id WHERE s.token_hash=? AND s.expires_at>? AND c.status='active' AND n.state!='disabled'`, hash, now()).Scan(&node, &expiry)
	if errors.Is(err, sql.ErrNoRows) {
		err = auth.ErrUnauthorized
	}
	if err != nil {
		return "", time.Time{}, err
	}
	t, err := time.Parse(time.RFC3339Nano, expiry)
	return node, t, err
}
func (s *Store) RevokeNode(ctx context.Context, actor, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	r, err := tx.ExecContext(ctx, `UPDATE nodes SET state='disabled' WHERE id=?`, id)
	if err != nil {
		return err
	}
	n, _ := r.RowsAffected()
	if n == 0 {
		return auth.ErrNotFound
	}
	if _, err = tx.ExecContext(ctx, `UPDATE agent_credentials SET status='revoked',revoked_at=? WHERE node_id=?`, now(), id); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM agent_sessions WHERE node_id=?`, id); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM agent_challenges WHERE node_id=?`, id); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE tasks SET state='cancelled',updated_at=? WHERE node_id=? AND state IN ('queued','dispatched','accepted','running')`, now(), id); err != nil {
		return err
	}
	if err = audit(ctx, tx, actor, "node.revoke", "node", id); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) Enrollments(ctx context.Context, limit int, after string) ([]auth.EnrollmentRecord, error) {
	rows, e := s.db.QueryContext(ctx, `SELECT id,name,kind,expires_at,CASE WHEN revoked_at IS NOT NULL THEN 'revoked' WHEN used_at IS NOT NULL THEN 'used' WHEN expires_at<=? THEN 'expired' ELSE 'active' END FROM enrollment_tokens WHERE id>? ORDER BY id LIMIT ?`, now(), after, limit)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []auth.EnrollmentRecord{}
	for rows.Next() {
		var v auth.EnrollmentRecord
		var expiry string
		if e = rows.Scan(&v.ID, &v.Name, &v.Kind, &expiry, &v.State); e != nil {
			return nil, e
		}
		v.ExpiresAt, e = time.Parse(time.RFC3339Nano, expiry)
		if e != nil {
			return nil, e
		}
		v.CreatedAt = v.ExpiresAt.Add(-15 * time.Minute)
		out = append(out, v)
	}
	return out, rows.Err()
}
