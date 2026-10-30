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
	if _, err = tx.ExecContext(ctx, `INSERT INTO nodes(id,enrollment_token_hash,name,kind,enrollment_expires_at,created_by,created_at) VALUES(?,?,?,?,?,?,?)`, v.ID, hash, name, kind, at(v.ExpiresAt), actor, now()); err != nil {
		return err
	}
	if err = audit(ctx, tx, actor, "node.create", "node", v.ID); err != nil {
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
	r, err := tx.ExecContext(ctx, `UPDATE nodes SET enrollment_revoked_at=? WHERE id=?`, now(), id)
	if err != nil {
		return err
	}
	n, _ := r.RowsAffected()
	if n == 0 {
		return auth.ErrNotFound
	}
	if err = audit(ctx, tx, actor, "node.enrollment.revoke", "node", id); err != nil {
		return err
	}
	return tx.Commit()
}
func (s *Store) Enroll(ctx context.Context, hash, key string) (string, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	var id string
	err = tx.QueryRowContext(ctx, `UPDATE nodes SET enrollment_used_at=?,state='offline' WHERE enrollment_token_hash=? AND enrollment_used_at IS NULL AND enrollment_revoked_at IS NULL AND enrollment_expires_at>? AND state='pending' RETURNING id`, now(), hash, now()).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		// Recover a lost enrollment response only for the exact token/key binding.
		err = tx.QueryRowContext(ctx, `SELECT n.id FROM nodes n JOIN agent_credentials c ON c.node_id=n.id WHERE n.enrollment_token_hash=? AND n.enrollment_expires_at>? AND n.enrollment_revoked_at IS NULL AND n.state!='disabled' AND c.public_key=? AND c.status='active'`, hash, now(), key).Scan(&id)
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
	if _, err = tx.ExecContext(ctx, `INSERT INTO agent_credentials(id,node_id,public_key,status,created_at) VALUES(?,?,?,'active',?)`, auth.Random(), id, key, now()); err != nil {
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
	r, err := tx.ExecContext(ctx, `UPDATE nodes SET state='disabled',enrollment_revoked_at=? WHERE id=?`, now(), id)
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
