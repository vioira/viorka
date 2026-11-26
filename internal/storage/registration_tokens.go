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

// ResetEnrollment preserves configuration and history but invalidates runtime observations.
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
	if _, err = tx.ExecContext(ctx, `UPDATE nodes SET state='pending',agent_management_connected=0,agent_update_capable=0,agent_auto_update=0,agent_update_last_target='',origin_capable=-1,origin_migration='',offline_alert_since=NULL,enrollment_token_hash=?,enrollment_expires_at=?,enrollment_used_at=NULL,enrollment_revoked_at=NULL WHERE id=?`, hash, at(v.ExpiresAt), v.ID); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO subscription_restore_engines(engine_id,restored_at,state,requested_by,reason)
 SELECT id,?,'pending',?,'reenrollment' FROM engines WHERE node_id=? AND ownership='managed'
 ON CONFLICT(engine_id) DO UPDATE SET restored_at=excluded.restored_at,requested_by=excluded.requested_by,state='pending',
 task_id='',observed_encrypted='',observed_revision=0,reason=CASE WHEN subscription_restore_engines.reason='reenrollment' THEN 'reenrollment' ELSE 'restore_reenrollment' END`, now(), actor, v.ID); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE engines SET status='unknown',version=NULL,observed_at='',observed_revision=0 WHERE node_id=? AND ownership='managed'`, v.ID); err != nil {
		return err
	}
	if err = audit(ctx, tx, actor, "node.enrollment.reset", "node", v.ID); err != nil {
		return err
	}
	return s.commitChanges(tx, realtime.Change{Kind: "node", NodeID: v.ID}, realtime.Change{Kind: "engines", NodeID: v.ID})
}
