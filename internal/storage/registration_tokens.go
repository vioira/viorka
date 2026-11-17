package storage

import (
	"context"
	"database/sql"
	"errors"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/realtime"
)

// RenewEnrollment replaces only an unused credential, atomically with its audit record.
func (s *Store) RenewEnrollment(ctx context.Context, actor, hash string, v auth.Enrollment) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var id string
	err = tx.QueryRowContext(ctx, `UPDATE nodes SET enrollment_token_hash=?, enrollment_expires_at=?, enrollment_revoked_at=NULL WHERE id=? AND state='pending' AND enrollment_used_at IS NULL AND NOT EXISTS (SELECT 1 FROM agent_credentials WHERE node_id=nodes.id) RETURNING id`, hash, at(v.ExpiresAt), v.ID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		err = tx.QueryRowContext(ctx, `SELECT id FROM nodes WHERE id=?`, v.ID).Scan(&id)
		if errors.Is(err, sql.ErrNoRows) {
			return auth.ErrNotFound
		}
		if err != nil {
			return err
		}
		return auth.ErrConflict
	}
	if err != nil {
		return err
	}
	if err = audit(ctx, tx, actor, "node.enrollment.renew", "node", id); err != nil {
		return err
	}
	return tx.Commit()
}

// ResetEnrollment preserves the node and all its business/history records.
// The first write serializes this operation against registration and task creation.
func (s *Store) ResetEnrollment(ctx context.Context, actor, hash string, v auth.Enrollment) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var state string
	err = tx.QueryRowContext(ctx, `UPDATE nodes SET state=state WHERE id=? RETURNING state`, v.ID).Scan(&state)
	if errors.Is(err, sql.ErrNoRows) {
		return auth.ErrNotFound
	}
	if err != nil {
		return err
	}
	if state != "offline" && state != "disabled" && state != "pending" {
		return auth.ErrConflict
	}
	var busy bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM tasks WHERE node_id=? AND state IN ('queued','dispatched','accepted','running'))`, v.ID).Scan(&busy); err != nil {
		return err
	}
	if busy {
		return auth.ErrConflict
	}
	for _, table := range []string{"agent_sessions", "agent_challenges", "agent_credentials"} {
		if _, err = tx.ExecContext(ctx, `DELETE FROM `+table+` WHERE node_id=?`, v.ID); err != nil {
			return err
		}
	}
	if _, err = tx.ExecContext(ctx, `UPDATE nodes SET state='pending',enrollment_token_hash=?,enrollment_expires_at=?,enrollment_used_at=NULL,enrollment_revoked_at=NULL WHERE id=?`, hash, at(v.ExpiresAt), v.ID); err != nil {
		return err
	}
	if err = audit(ctx, tx, actor, "node.enrollment.reset", "node", v.ID); err != nil {
		return err
	}
	return s.commitChanges(tx, realtime.Change{Kind: "node", NodeID: v.ID})
}
