package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/vioira/viorka/internal/agentupdate"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/realtime"
	"github.com/vioira/viorka/internal/scheduler"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func (s *Store) SaveAgentReleases(ctx context.Context, assets map[string]v1.AgentUpdate) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, arch := range []string{"amd64", "arm64"} {
		u := assets[arch]
		if _, err = tx.ExecContext(ctx, `INSERT INTO agent_release_assets(arch,version,sha256,checked_at) VALUES(?,?,?,?) ON CONFLICT(arch) DO UPDATE SET version=excluded.version,sha256=excluded.sha256,checked_at=excluded.checked_at`, arch, u.Version, u.SHA256, now()); err != nil {
			return err
		}
	}
	return tx.Commit()
}

type updateQuery interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func agentStatus(ctx context.Context, q updateQuery, node string) (agentupdate.AgentUpdateStatus, error) {
	var s agentupdate.AgentUpdateStatus
	var u v1.AgentUpdate
	err := q.QueryRowContext(ctx, `SELECT n.agent_auto_update,n.agent_update_capable,n.agent_management_connected,coalesce(n.agent_version,''),coalesce(a.version,''),coalesce(a.sha256,''),coalesce(a.checked_at,''),coalesce((SELECT id FROM tasks WHERE node_id=n.id AND task_type='agent.update' AND state IN ('queued','dispatched','accepted','running')),'') FROM nodes n LEFT JOIN agent_release_assets a ON a.arch=n.arch WHERE n.id=?`, node).Scan(&s.Auto, &s.Capable, &s.Online, &s.Current, &u.Version, &u.SHA256, &s.CheckedAt, &s.ActiveTask)
	if errors.Is(err, sql.ErrNoRows) {
		err = auth.ErrNotFound
	}
	if u.Valid() {
		s.Target = &u
		s.Available = u.NewerThan(s.Current) && s.CheckedAt > at(time.Now().Add(-2*time.Hour))
	}
	return s, err
}
func (s *Store) AgentUpdateStatus(ctx context.Context, node string) (agentupdate.AgentUpdateStatus, error) {
	return agentStatus(ctx, s.db, node)
}

func (s *Store) SetAgentAutoUpdate(ctx context.Context, actor, node string, enabled bool) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	r, err := tx.ExecContext(ctx, `UPDATE nodes SET agent_auto_update=? WHERE id=? AND state!='disabled' AND (?=0 OR agent_update_capable=1)`, enabled, node, enabled)
	if err != nil {
		return err
	}
	if n, err := r.RowsAffected(); err != nil {
		return err
	} else if n != 1 {
		if _, err := agentStatus(ctx, tx, node); err != nil {
			return err
		}
		return auth.ErrConflict
	}
	if !enabled {
		r, err = tx.ExecContext(ctx, `UPDATE tasks SET state='cancelled',updated_at=? WHERE node_id=? AND task_type='agent.update' AND idempotency_key LIKE 'auto-%' AND state='queued' AND attempt=0`, now(), node)
		if err != nil {
			return err
		}
		if n, err := r.RowsAffected(); err != nil {
			return err
		} else if n > 0 {
			if _, err = tx.ExecContext(ctx, `UPDATE nodes SET agent_update_last_target='' WHERE id=?`, node); err != nil {
				return err
			}
		}
	}
	if err = audit(ctx, tx, actor, "agent.update.policy", "node", node); err != nil {
		return err
	}
	return s.commitChanges(tx, realtime.Change{Kind: "node", NodeID: node}, realtime.Change{Kind: "tasks", NodeID: node})
}

func (s *Store) QueueAgentUpdate(ctx context.Context, actor, node string, target v1.AgentUpdate) (scheduler.Task, error) {
	return s.queueAgentUpdate(ctx, actor, node, &target)
}
func (s *Store) queueAgentUpdate(ctx context.Context, actor, node string, target *v1.AgentUpdate) (scheduler.Task, error) {
	var task scheduler.Task
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return task, err
	}
	defer tx.Rollback()
	var last string
	err = tx.QueryRowContext(ctx, `UPDATE nodes SET state=state WHERE id=? RETURNING agent_update_last_target`, node).Scan(&last)
	if errors.Is(err, sql.ErrNoRows) {
		return task, auth.ErrNotFound
	}
	if err != nil {
		return task, err
	}
	status, err := agentStatus(ctx, tx, node)
	if err != nil {
		return task, err
	}
	if status.ActiveTask != "" {
		if target != nil {
			var raw string
			var queued agentupdate.TaskInfo
			if err = tx.QueryRowContext(ctx, `SELECT payload_json FROM tasks WHERE id=?`, status.ActiveTask).Scan(&raw); err != nil {
				return task, err
			}
			if err = json.Unmarshal([]byte(raw), &queued); err != nil {
				return task, err
			}
			if queued.Target != *target {
				return task, auth.ErrConflict
			}
		}
		if err = tx.Commit(); err != nil {
			return task, err
		}
		return s.Task(ctx, status.ActiveTask)
	}
	if !status.Capable || !status.Online || !status.Available || target != nil && *target != *status.Target {
		return task, auth.ErrConflict
	}
	source := "manual"
	if target == nil {
		source = "auto"
		if !status.Auto || last == status.Target.Version {
			return task, auth.ErrConflict
		}
	}
	var busy bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM tasks WHERE node_id=? AND state IN ('queued','accepted','dispatched','running'))`, node).Scan(&busy); err != nil {
		return task, err
	}
	if busy {
		return task, auth.ErrConflict
	}
	id := auth.Random()
	payload, err := json.Marshal(agentupdate.TaskInfo{Target: *status.Target, From: status.Current, Source: source})
	if err != nil {
		return task, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO tasks(id,node_id,task_type,idempotency_key,state,created_at,updated_at,deadline_at,payload_json,max_attempts) VALUES(?,?,'agent.update',?,'queued',?,?,?,?,?)`, id, node, source+"-"+id, now(), now(), at(time.Now().Add(10*time.Minute)), string(payload), 1)
	if err != nil {
		return task, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE nodes SET agent_update_last_target=? WHERE id=?`, status.Target.Version, node); err != nil {
		return task, err
	}
	if err = audit(ctx, tx, actor, "agent.update."+source, "task", id); err != nil {
		return task, err
	}
	if err = s.commitChanges(tx, realtime.Change{Kind: "tasks", NodeID: node, TaskID: id}); err != nil {
		return task, err
	}
	return s.Task(ctx, id)
}
func (s *Store) ScheduleAgentUpdate(ctx context.Context, after string) (string, error) {
	var id string
	err := s.db.QueryRowContext(ctx, `SELECT n.id FROM nodes n JOIN agent_release_assets a ON a.arch=n.arch WHERE n.id>? AND n.agent_management_connected=1 AND n.agent_auto_update=1 AND n.agent_update_capable=1 AND n.state='online' AND a.version!='' AND a.version!=n.agent_update_last_target AND a.version!=n.agent_version AND a.version!=('v'||n.agent_version) ORDER BY n.id LIMIT 1`, after).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return after, err
	}
	_, err = s.queueAgentUpdate(ctx, "", id, nil)
	if errors.Is(err, auth.ErrConflict) {
		err = nil
	}
	return id, err
}

func (s *Store) replyAgentUpdate(ctx context.Context, tx *sql.Tx, node, kind, state string, attempt uint64, payload string, v v1.TaskReply) error {
	var request agentupdate.TaskInfo
	if err := json.Unmarshal([]byte(payload), &request); err != nil {
		return err
	}
	if attempt != v.Attempt {
		return auth.ErrConflict
	}
	if v.Engine != nil || v.Inspection != nil || v.TrafficBefore != nil || v.TrafficCalibration != nil {
		return auth.ErrInvalid
	}
	if state != "accepted" && state != "dispatched" {
		return auth.ErrConflict
	}
	var result any
	if kind == "task.result" {
		if v.AgentUpdate == nil || *v.AgentUpdate != request.Target {
			return auth.ErrInvalid
		}
		if v.State == "succeeded" {
			var current string
			if err := tx.QueryRowContext(ctx, `SELECT agent_version FROM nodes WHERE id=?`, node).Scan(&current); err != nil {
				return err
			}
			if v.ErrorCode != "" || ("v"+current != request.Target.Version && current != request.Target.Version) {
				return auth.ErrConflict
			}
		} else {
			switch v.ErrorCode {
			case "update_failed", "update_rolled_back", "update_rollback_failed", "deadline_exceeded":
			default:
				return auth.ErrInvalid
			}
		}
		b, err := json.Marshal(v)
		if err != nil {
			return err
		}
		result = string(b)
	} else if v.AgentUpdate != nil || v.ErrorCode != "" {
		return auth.ErrInvalid
	}
	r, err := tx.ExecContext(ctx, `UPDATE tasks SET state=?,result_json=?,updated_at=? WHERE id=? AND attempt=? AND state IN ('accepted','dispatched')`, v.State, result, now(), v.TaskID, v.Attempt)
	if err != nil {
		return err
	}
	if n, err := r.RowsAffected(); err != nil {
		return err
	} else if n != 1 {
		return auth.ErrConflict
	}
	return s.commitChanges(tx, realtime.Change{Kind: "tasks", NodeID: node, TaskID: v.TaskID})
}

func (s *Store) ManagementDisconnected(ctx context.Context, node string) error {
	if _, err := s.db.ExecContext(ctx, `UPDATE nodes SET agent_management_connected=0 WHERE id=?`, node); err != nil {
		return err
	}
	s.events.Publish(realtime.Change{Kind: "node", NodeID: node})
	return nil
}
