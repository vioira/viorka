package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/realtime"
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
	if n == 1 {
		s.events.Publish(realtime.Change{Kind: "tasks", NodeID: node})
	}
	return s.Task(ctx, id)
}
func (s *Store) Task(ctx context.Context, id string) (scheduler.Task, error) {
	t, err := scanTask(s.db.QueryRowContext(ctx, `SELECT `+taskColumns+` FROM tasks t JOIN nodes n ON n.id=t.node_id WHERE t.id=?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		err = auth.ErrNotFound
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
	result, err := tx.ExecContext(ctx, `UPDATE tasks SET state='failed',last_error='deadline_or_attempts_exhausted',updated_at=? WHERE node_id=? AND state IN ('queued','dispatched','accepted','running') AND (deadline_at<=? OR (attempt>=max_attempts AND lease_until<=?))`, now(), node, now(), now())
	if err != nil {
		return nil, err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	commit := func() error {
		if err := tx.Commit(); err != nil {
			return err
		}
		if changed > 0 {
			s.events.Publish(realtime.Change{Kind: "tasks", NodeID: node})
		}
		return nil
	}
	var active int
	if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM tasks WHERE node_id=? AND state IN ('dispatched','accepted','running') AND lease_until>?`, node, now()).Scan(&active); err != nil {
		return nil, err
	}
	if active > 0 {
		return nil, commit()
	}
	var d v1.TaskDispatch
	var attempt uint64
	var deadline string
	err = tx.QueryRowContext(ctx, `UPDATE tasks SET state='dispatched',attempt=attempt+1,lease_until=?,updated_at=? WHERE id=(SELECT t.id FROM tasks t JOIN nodes n ON n.id=t.node_id WHERE t.node_id=? AND n.state='online' AND t.task_type='node.inspect' AND t.state IN ('queued','dispatched','accepted','running') AND (t.lease_until IS NULL OR t.lease_until<=?) AND t.attempt<t.max_attempts AND t.deadline_at>? ORDER BY t.created_at,t.id LIMIT 1) RETURNING id,task_type,idempotency_key,attempt,deadline_at`, at(time.Now().Add(30*time.Second)), now(), node, now(), now()).Scan(&d.TaskID, &d.Operation, &d.IdempotencyKey, &attempt, &deadline)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, commit()
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
	changed++
	return &d, commit()
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
	return s.commitChanges(tx, realtime.Change{Kind: "tasks", NodeID: node})
}

// Expire also processes offline nodes so queued work cannot remain pending forever.
func (s *Store) Expire(ctx context.Context) error {
	result, err := s.db.ExecContext(ctx, `UPDATE tasks SET state='failed',last_error='deadline_exceeded',updated_at=? WHERE state IN ('queued','dispatched','accepted','running') AND deadline_at<=?`, now(), now())
	if err != nil {
		return err
	}
	changed, err := result.RowsAffected()
	if err == nil && changed > 0 {
		s.events.Publish(realtime.Change{Kind: "tasks"})
	}
	return err
}

// Tasks returns this node's tasks newest first, using an exclusive task ID cursor.
func (s *Store) Tasks(ctx context.Context, node string, limit int, after string) ([]scheduler.Task, error) {
	var created string
	if after != "" {
		err := s.db.QueryRowContext(ctx, `SELECT created_at FROM tasks WHERE id=? AND node_id=?`, after, node).Scan(&created)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, auth.ErrInvalid
		}
		if err != nil {
			return nil, err
		}
	}
	rows, err := s.db.QueryContext(ctx, `SELECT `+taskColumns+` FROM tasks t JOIN nodes n ON n.id=t.node_id WHERE t.node_id=? AND (?='' OR t.created_at<? OR (t.created_at=? AND t.id<?)) ORDER BY t.created_at DESC,t.id DESC LIMIT ?`, node, after, created, created, after, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []scheduler.Task{}
	for rows.Next() {
		task, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, task)
	}
	return items, rows.Err()
}

// Only public task metadata is selected; payload_json and arbitrary last_error text
// are never exposed. The error code is restricted to known scheduler/protocol codes.
const taskColumns = `t.id,t.node_id,t.task_type,t.idempotency_key,t.state,t.attempt,coalesce(t.deadline_at,''),t.result_json,n.name,t.max_attempts,t.created_at,t.updated_at,coalesce(t.last_error,'')`

func scanTask(row interface{ Scan(...any) error }) (scheduler.Task, error) {
	var task scheduler.Task
	var result sql.NullString
	var lastError string
	err := row.Scan(&task.ID, &task.NodeID, &task.Operation, &task.IdempotencyKey, &task.State, &task.Attempt, &task.DeadlineAt, &result, &task.NodeName, &task.MaxAttempts, &task.CreatedAt, &task.UpdatedAt, &lastError)
	if err != nil {
		return task, err
	}
	if result.Valid {
		task.Result = json.RawMessage(result.String)
	}
	if task.State == "failed" {
		if result.Valid {
			var reply v1.TaskReply
			if err := json.Unmarshal(task.Result, &reply); err != nil {
				return task, err
			}
			lastError = reply.ErrorCode
		}
		switch lastError {
		case "inspection_failed", "deadline_exceeded", "deadline_or_attempts_exhausted":
			task.ErrorCode = lastError
		}
	}
	return task, nil
}

func (s *Store) TaskPage(ctx context.Context, limit int, after, state string) (scheduler.Page, error) {
	var created string
	if after != "" {
		err := s.db.QueryRowContext(ctx, `SELECT created_at FROM tasks WHERE id=?`, after).Scan(&created)
		if errors.Is(err, sql.ErrNoRows) {
			return scheduler.Page{}, auth.ErrInvalid
		}
		if err != nil {
			return scheduler.Page{}, err
		}
	}
	rows, err := s.db.QueryContext(ctx, `SELECT `+taskColumns+` FROM tasks t JOIN nodes n ON n.id=t.node_id WHERE (?='all' OR t.state=?) AND (?='' OR (t.created_at,t.id)<(?,?)) ORDER BY t.created_at DESC,t.id DESC LIMIT ?`, state, state, after, created, after, limit+1)
	if err != nil {
		return scheduler.Page{}, err
	}
	defer rows.Close()
	page := scheduler.Page{Items: []scheduler.Task{}}
	for rows.Next() {
		task, err := scanTask(rows)
		if err != nil {
			return scheduler.Page{}, err
		}
		page.Items = append(page.Items, task)
	}
	if err := rows.Err(); err != nil {
		return scheduler.Page{}, err
	}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		page.NextCursor = page.Items[limit-1].ID
	}
	return page, nil
}
func (s *Store) TaskSummary(ctx context.Context) (scheduler.Summary, error) {
	until := time.Now().UTC()
	result := scheduler.Summary{Since: at(until.Add(-24 * time.Hour)), Until: at(until)}
	err := s.db.QueryRowContext(ctx, `SELECT count(*),coalesce(sum(state='succeeded'),0),coalesce(sum(state='failed'),0),(SELECT count(*) FROM tasks WHERE state IN ('queued','dispatched','accepted','running')) FROM tasks WHERE created_at>=? AND created_at<=?`, result.Since, result.Until).Scan(&result.Total, &result.Succeeded, &result.Failed, &result.Active)
	if err != nil {
		return scheduler.Summary{}, err
	}
	if completed := result.Succeeded + result.Failed; completed > 0 {
		rate := float64(result.Succeeded) * 100 / float64(completed)
		result.SuccessRate = &rate
	}
	return result, nil
}
