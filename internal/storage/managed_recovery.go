package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/proxy"
	"github.com/vioira/viorka/internal/realtime"
	"github.com/vioira/viorka/internal/scheduler"
	v1 "github.com/vioira/viorka/protocol/v1"
)

type managedRecoveryTask struct {
	Name  string `json:"name"`
	Actor string `json:"actor"`
}

func requireRecoveryAdmin(ctx context.Context, tx *sql.Tx, actor string) error {
	var role string
	err := tx.QueryRowContext(ctx, `SELECT role FROM users WHERE id=?`, actor).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) || err == nil && role != "admin" {
		return proxy.ErrForbidden
	}
	return err
}

func lockRecoveryNode(ctx context.Context, tx *sql.Tx, node string) error {
	var osName, state string
	var capable, recoveryCapable bool
	err := tx.QueryRowContext(ctx, `UPDATE nodes SET state=state WHERE id=? RETURNING state,coalesce(os,''),engine_capable,engine_recovery_capable`, node).Scan(&state, &osName, &capable, &recoveryCapable)
	if errors.Is(err, sql.ErrNoRows) {
		return auth.ErrNotFound
	}
	if err != nil {
		return err
	}
	if state != "online" || osName != "linux" || !capable || !recoveryCapable {
		return proxy.ErrRecoveryUnsupported
	}
	return nil
}

// Only the bookkeeping left by a rejected install and read-only checks is
// disposable. Leave the task records intact when removing their engine links.
func recoverySlot(ctx context.Context, tx *sql.Tx, node, name string) (string, error) {
	var id string
	var empty bool
	err := tx.QueryRowContext(ctx, `SELECT e.id,e.ownership='managed' AND coalesce(e.version,'')='' AND e.observed_revision=0 AND e.status IN ('not_installed','unknown')
  AND NOT EXISTS(SELECT 1 FROM engine_drafts d WHERE d.engine_id=e.id AND (d.version!=0 OR coalesce(nullif(d.services_json,'null'),'[]')!='[]' OR d.routing_json!='null'))
  AND NOT EXISTS(SELECT 1 FROM engine_targets t WHERE t.engine_id=e.id)
  AND NOT EXISTS(SELECT 1 FROM engine_credentials c WHERE c.engine_id=e.id)
  AND NOT EXISTS(SELECT 1 FROM engine_port_reservations p WHERE p.engine_id=e.id)
  AND NOT EXISTS(SELECT 1 FROM proxy_services p WHERE p.engine_id=e.id)
  AND NOT EXISTS(SELECT 1 FROM relay_rules r WHERE r.engine_id=e.id)
  AND NOT EXISTS(SELECT 1 FROM subscription_service_links l WHERE l.engine_id=e.id)
  AND NOT EXISTS(SELECT 1 FROM subscription_restore_engines r WHERE r.engine_id=e.id)
  AND NOT EXISTS(SELECT 1 FROM engine_operations o JOIN tasks t ON t.id=o.task_id WHERE o.engine_id=e.id AND
    (o.active=1 OR NOT(o.operation='engine.inspect' AND t.state IN ('succeeded','failed','cancelled') OR o.operation='engine.install' AND t.state='failed' AND coalesce(json_extract(t.result_json,'$.error_code'),'')='engine_external')))
  FROM engines e WHERE e.node_id=? AND e.name=?`, node, name).Scan(&id, &empty)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if !empty {
		return "", proxy.ErrRecoveryOccupied
	}
	return id, nil
}

func (s *Store) StartManagedRecovery(ctx context.Context, actor, node, name, key string) (scheduler.Task, error) {
	if !proxy.ValidEngine(name) || len(key) < 1 || len(key) > 128 {
		return scheduler.Task{}, proxy.ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return scheduler.Task{}, err
	}
	defer tx.Rollback()
	if err = requireRecoveryAdmin(ctx, tx, actor); err != nil {
		return scheduler.Task{}, err
	}
	if err = lockRecoveryNode(ctx, tx, node); err != nil {
		return scheduler.Task{}, err
	}
	request, err := json.Marshal(managedRecoveryTask{Name: name, Actor: actor})
	if err != nil {
		return scheduler.Task{}, err
	}
	var task, operation, existing string
	err = tx.QueryRowContext(ctx, `SELECT id,task_type,payload_json FROM tasks WHERE node_id=? AND idempotency_key=?`, node, key).Scan(&task, &operation, &existing)
	if err == nil {
		if operation != v1.EngineRecoverOperation || existing != string(request) {
			return scheduler.Task{}, proxy.ErrConflict
		}
		tx.Rollback()
		return s.Task(ctx, task)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return scheduler.Task{}, err
	}
	if _, err = recoverySlot(ctx, tx, node, name); err != nil {
		return scheduler.Task{}, err
	}
	var busy bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM tasks WHERE node_id=? AND task_type=? AND deadline_at>? AND state IN ('queued','dispatched','accepted','running'))`, node, v1.EngineRecoverOperation, now()).Scan(&busy); err != nil {
		return scheduler.Task{}, err
	}
	if busy {
		return scheduler.Task{}, proxy.ErrConflict
	}
	task = auth.Random()
	if _, err = tx.ExecContext(ctx, `INSERT INTO tasks(id,node_id,task_type,idempotency_key,state,payload_json,created_at,updated_at,deadline_at,max_attempts) VALUES(?,?,?,?,'queued',?,?,?,?,3)`, task, node, v1.EngineRecoverOperation, key, string(request), now(), now(), at(time.Now().Add(5*time.Minute))); err != nil {
		return scheduler.Task{}, err
	}
	if err = audit(ctx, tx, actor, "engine.recovery.inspect", "node", node); err != nil {
		return scheduler.Task{}, err
	}
	if err = s.commitChanges(tx, realtime.Change{Kind: "tasks", NodeID: node, TaskID: task}); err != nil {
		return scheduler.Task{}, err
	}
	return s.Task(ctx, task)
}

func (s *Store) replyManagedRecovery(ctx context.Context, tx *sql.Tx, node, kind, state, payload string, attempt uint64, reply v1.TaskReply) error {
	if reply.Attempt != attempt {
		return auth.ErrConflict
	}
	if state == "succeeded" || state == "failed" || state == "cancelled" {
		return tx.Commit()
	}
	if state != "dispatched" && state != "accepted" {
		return auth.ErrConflict
	}
	if reply.Inspection != nil || reply.TrafficCalibration != nil || reply.TrafficBefore != nil {
		return auth.ErrInvalid
	}
	if kind == "task.ack" {
		if reply.Engine != nil || reply.ErrorCode != "" {
			return auth.ErrInvalid
		}
		if _, err := tx.ExecContext(ctx, `UPDATE tasks SET state='accepted',updated_at=? WHERE id=?`, now(), reply.TaskID); err != nil {
			return err
		}
		return tx.Commit()
	}

	var request managedRecoveryTask
	if err := json.Unmarshal([]byte(payload), &request); err != nil {
		return err
	}
	result := reply.Engine
	if result == nil || result.Name != request.Name || result.Revision != 0 || result.Configuration != nil || result.RecoveryRevision != nil || !v1.ValidEngineDiagnostic(result.Diagnostic) {
		return auth.ErrInvalid
	}
	if reply.State == "succeeded" {
		snapshot := result.Recovery
		if reply.ErrorCode != "" || result.ErrorCode != "" || result.Diagnostic != nil || v1.ValidateEngineRecovery([]*v1.EngineRecovery{snapshot}) != nil || snapshot.Command.Name != request.Name || snapshot.Command.Version != result.Version || snapshot.Status != result.Status {
			return auth.ErrInvalid
		}
		raw, err := json.Marshal(snapshot)
		if err != nil {
			return err
		}
		encrypted, err := s.sealEngine(reply.TaskID, raw)
		if err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO managed_engine_recoveries(task_id,snapshot_encrypted) VALUES(?,?)`, reply.TaskID, encrypted); err != nil {
			return err
		}
	} else if result.Recovery != nil || !v1.EngineErrorCode(reply.ErrorCode) || result.ErrorCode != reply.ErrorCode {
		return auth.ErrInvalid
	}
	publicReply := v1.TaskReply{TaskID: reply.TaskID, ResourceID: node, Attempt: attempt, State: reply.State, ErrorCode: reply.ErrorCode}
	raw, err := json.Marshal(publicReply)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE tasks SET state=?,result_json=?,updated_at=? WHERE id=?`, reply.State, string(raw), now(), reply.TaskID); err != nil {
		return err
	}
	return s.commitChanges(tx, realtime.Change{Kind: "tasks", NodeID: node, TaskID: reply.TaskID})
}

func (s *Store) readManagedRecovery(ctx context.Context, tx *sql.Tx, actor, node, task string) (proxy.ManagedRecoveryPreview, *v1.EngineRecovery, error) {
	view := proxy.ManagedRecoveryPreview{Services: []proxy.ManagedRecoveryService{}}
	var requestRaw, deadline, encrypted string
	err := tx.QueryRowContext(ctx, `SELECT t.state,coalesce(json_extract(t.result_json,'$.error_code'),t.last_error,''),t.payload_json,t.deadline_at,coalesce(r.snapshot_encrypted,''),coalesce(r.recovered_engine_id,'') FROM tasks t LEFT JOIN managed_engine_recoveries r ON r.task_id=t.id WHERE t.node_id=? AND t.id=? AND t.task_type=?`, node, task, v1.EngineRecoverOperation).Scan(&view.State, &view.ErrorCode, &requestRaw, &deadline, &encrypted, &view.EngineID)
	if errors.Is(err, sql.ErrNoRows) {
		return view, nil, auth.ErrNotFound
	}
	if err != nil {
		return view, nil, err
	}
	var request managedRecoveryTask
	if err = json.Unmarshal([]byte(requestRaw), &request); err != nil {
		return view, nil, err
	}
	if request.Actor != actor {
		return view, nil, auth.ErrNotFound
	}
	view.Name = request.Name
	view.Recovered = view.EngineID != ""
	if view.Recovered || view.State != "succeeded" {
		return view, nil, nil
	}
	expires, err := time.Parse(time.RFC3339Nano, deadline)
	if err != nil {
		return view, nil, err
	}
	if encrypted == "" || !time.Now().Before(expires) {
		return view, nil, proxy.ErrRecoveryExpired
	}
	raw, err := s.openEngine(task, encrypted)
	if err != nil {
		return view, nil, err
	}
	var snapshot v1.EngineRecovery
	if err = json.Unmarshal(raw, &snapshot); err != nil {
		return view, nil, err
	}
	if v1.ValidateEngineRecovery([]*v1.EngineRecovery{&snapshot}) != nil || snapshot.Command.Name != view.Name {
		return view, nil, proxy.ErrInvalid
	}
	view.EngineID, view.Version, view.Status, view.RunIntent, view.Revision = snapshot.EngineID, snapshot.Command.Version, snapshot.Status, snapshot.Command.RunIntent, snapshot.Command.Revision
	view.Configured = !snapshot.Unconfigured
	for _, svc := range snapshot.Command.Services {
		view.Services = append(view.Services, proxy.ManagedRecoveryService{ID: svc.ID, Name: svc.Name, Enabled: svc.Enabled, ListenPort: svc.ListenPort})
	}
	return view, &snapshot, nil
}

func (s *Store) PreviewManagedRecovery(ctx context.Context, actor, node, task string) (proxy.ManagedRecoveryPreview, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return proxy.ManagedRecoveryPreview{}, err
	}
	defer tx.Rollback()
	if err = requireRecoveryAdmin(ctx, tx, actor); err != nil {
		return proxy.ManagedRecoveryPreview{}, err
	}
	view, _, err := s.readManagedRecovery(ctx, tx, actor, node, task)
	return view, err
}

func (s *Store) ConfirmManagedRecovery(ctx context.Context, actor, node, task string) (string, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	if err = requireRecoveryAdmin(ctx, tx, actor); err != nil {
		return "", err
	}
	// Serialize against other confirmations and all engine actions on this node.
	if _, err := tx.ExecContext(ctx, `UPDATE nodes SET state=state WHERE id=?`, node); err != nil {
		return "", err
	}
	view, snapshot, err := s.readManagedRecovery(ctx, tx, actor, node, task)
	if err != nil {
		return "", err
	}
	if view.Recovered {
		return view.EngineID, tx.Commit()
	}
	if snapshot == nil {
		return "", proxy.ErrConflict
	}
	if err = lockRecoveryNode(ctx, tx, node); err != nil {
		return "", err
	}
	slot, err := recoverySlot(ctx, tx, node, view.Name)
	if err != nil {
		return "", err
	}
	var owned bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM engines WHERE id=? AND id!=?)`, snapshot.EngineID, slot).Scan(&owned); err != nil {
		return "", err
	}
	if owned {
		return "", proxy.ErrRecoveryOwned
	}
	if slot != "" {
		if _, err = tx.ExecContext(ctx, `DELETE FROM engine_operations WHERE engine_id=?`, slot); err != nil {
			return "", err
		}
		if _, err = tx.ExecContext(ctx, `DELETE FROM engines WHERE id=?`, slot); err != nil {
			return "", err
		}
	}
	if err = s.restoreManagedEngines(ctx, tx, node, actor, []*v1.EngineRecovery{snapshot}); err != nil {
		return "", err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE managed_engine_recoveries SET recovered_engine_id=?,snapshot_encrypted='' WHERE task_id=?`, snapshot.EngineID, task); err != nil {
		return "", err
	}
	if err = audit(ctx, tx, actor, "engine.recovery.confirm", "engine", snapshot.EngineID); err != nil {
		return "", err
	}
	return snapshot.EngineID, s.commitChanges(tx, realtime.Change{Kind: "engines", NodeID: node, EngineID: snapshot.EngineID}, realtime.Change{Kind: "node", NodeID: node})
}
