package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/scheduler"
	v1 "github.com/vioira/viorka/protocol/v1"
	"time"
)

func (s *Store) CreateTask(ctx context.Context, actor, node, key string) (scheduler.Task, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return scheduler.Task{}, err
	}
	defer tx.Rollback()
	var state string
	if err = tx.QueryRowContext(ctx, `SELECT state FROM nodes WHERE id=?`, node).Scan(&state); errors.Is(err, sql.ErrNoRows) {
		return scheduler.Task{}, auth.ErrNotFound
	} else if err != nil {
		return scheduler.Task{}, err
	}
	if state == "disabled" {
		return scheduler.Task{}, auth.ErrConflict
	}
	id := auth.Random()
	r, err := tx.ExecContext(ctx, `INSERT INTO tasks(id,node_id,task_type,idempotency_key,state,created_at,updated_at,deadline_at) VALUES(?,?,'node.inspect',?,'queued',?,?,?) ON CONFLICT(node_id,idempotency_key) DO NOTHING`, id, node, key, now(), now(), at(time.Now().Add(5*time.Minute)))
	if err != nil {
		return scheduler.Task{}, err
	}
	n, _ := r.RowsAffected()
	if n == 1 {
		if err = audit(ctx, tx, actor, "task.create", "node", node); err != nil {
			return scheduler.Task{}, err
		}
	} else {
		if err = tx.QueryRowContext(ctx, `SELECT id FROM tasks WHERE node_id=? AND idempotency_key=? AND task_type='node.inspect'`, node, key).Scan(&id); err != nil {
			return scheduler.Task{}, auth.ErrConflict
		}
	}
	if err = tx.Commit(); err != nil {
		return scheduler.Task{}, err
	}
	return s.Task(ctx, id)
}
func (s *Store) Task(ctx context.Context, id string) (scheduler.Task, error) {
	var t scheduler.Task
	var result sql.NullString
	err := s.db.QueryRowContext(ctx, `SELECT id,node_id,task_type,idempotency_key,state,attempt,coalesce(deadline_at,''),result_json FROM tasks WHERE id=?`, id).Scan(&t.ID, &t.NodeID, &t.Operation, &t.IdempotencyKey, &t.State, &t.Attempt, &t.DeadlineAt, &result)
	if errors.Is(err, sql.ErrNoRows) {
		err = auth.ErrNotFound
	}
	if result.Valid {
		t.Result = json.RawMessage(result.String)
	}
	return t, err
}

// Claim only retries the explicitly read-only node.inspect operation. A lease plus
// attempt fences late replies; no other operation is eligible for automatic replay.
func (s *Store) Claim(ctx context.Context, node string) (*v1.TaskDispatch, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `UPDATE tasks SET state='failed',last_error='deadline_or_attempts_exhausted',updated_at=? WHERE node_id=? AND state IN ('queued','dispatched','accepted','running') AND (deadline_at<=? OR (attempt>=max_attempts AND lease_until<=?))`, now(), node, now(), now()); err != nil {
		return nil, err
	}
	var active int
	if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM tasks WHERE node_id=? AND state IN ('dispatched','accepted','running') AND lease_until>?`, node, now()).Scan(&active); err != nil {
		return nil, err
	}
	if active > 0 {
		return nil, tx.Commit()
	}
	var d v1.TaskDispatch
	var attempt uint64
	var deadline string
	err = tx.QueryRowContext(ctx, `UPDATE tasks SET state='dispatched',attempt=attempt+1,lease_until=?,updated_at=? WHERE id=(SELECT t.id FROM tasks t JOIN nodes n ON n.id=t.node_id WHERE t.node_id=? AND n.state='online' AND t.task_type='node.inspect' AND t.state IN ('queued','dispatched','accepted','running') AND (t.lease_until IS NULL OR t.lease_until<=?) AND t.attempt<t.max_attempts AND t.deadline_at>? ORDER BY t.created_at,t.id LIMIT 1) RETURNING id,task_type,idempotency_key,attempt,deadline_at`, at(time.Now().Add(30*time.Second)), now(), node, now(), now()).Scan(&d.TaskID, &d.Operation, &d.IdempotencyKey, &attempt, &deadline)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, tx.Commit()
	}
	if err != nil {
		return nil, err
	}
	d.Attempt = &attempt
	d.DeadlineAt, err = time.Parse(time.RFC3339Nano, deadline)
	if err != nil {
		return nil, err
	}
	d.ResourceKind = "node"
	d.ResourceID = node
	return &d, tx.Commit()
}
func (s *Store) Reply(ctx context.Context, node, kind string, v v1.TaskReply) error {
	if v.ResourceID != node || v.Attempt == 0 || len(v.TaskID) > 128 {
		return auth.ErrInvalid
	}
	if kind == "task.ack" && v.State != "accepted" {
		return auth.ErrInvalid
	}
	if kind == "task.result" && (v.State != "succeeded" && v.State != "failed") {
		return auth.ErrInvalid
	}
	if v.State == "succeeded" && (v.Inspection == nil || len(v.Inspection.Hostname) > 255 || len(v.Inspection.OS) > 64 || len(v.Inspection.Arch) > 64) {
		return auth.ErrInvalid
	}
	if v.State == "failed" && v.ErrorCode != "inspection_failed" && v.ErrorCode != "deadline_exceeded" {
		return auth.ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var state string
	var attempt uint64
	err = tx.QueryRowContext(ctx, `SELECT state,attempt FROM tasks WHERE id=? AND node_id=? AND task_type='node.inspect'`, v.TaskID, node).Scan(&state, &attempt)
	if errors.Is(err, sql.ErrNoRows) {
		return auth.ErrNotFound
	}
	if err != nil {
		return err
	}
	if attempt != v.Attempt {
		return auth.ErrConflict
	}
	if state == "succeeded" || state == "failed" || state == "cancelled" {
		return tx.Commit()
	}
	if state != "dispatched" && state != "accepted" {
		return auth.ErrConflict
	}
	var result any
	if kind == "task.result" {
		b, _ := json.Marshal(v)
		result = string(b)
	}
	if _, err = tx.ExecContext(ctx, `UPDATE tasks SET state=?,result_json=coalesce(?,result_json),updated_at=? WHERE id=?`, v.State, result, now(), v.TaskID); err != nil {
		return err
	}
	return tx.Commit()
}

// Expire also processes offline nodes so queued work cannot remain pending forever.
func (s *Store) Expire(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `UPDATE tasks SET state='failed',last_error='deadline_exceeded',updated_at=? WHERE state IN ('queued','dispatched','accepted','running') AND deadline_at<=?`, now(), now())
	return err
}
