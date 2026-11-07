package storage

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/proxy"
	"github.com/vioira/viorka/internal/realtime"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func (s *Store) ClaimEngines(ctx context.Context, node string) (*v1.TaskDispatch, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `UPDATE nodes SET state=state WHERE id=?`, node); err != nil {
		return nil, err
	}
	var changesBefore int64
	if err = tx.QueryRowContext(ctx, `SELECT total_changes()`).Scan(&changesBefore); err != nil {
		return nil, err
	}
	if err = s.reconcileEngineTargets(ctx, tx, node); err != nil {
		return nil, err
	}
	var d v1.TaskDispatch
	var encrypted, deadline string
	var attempt uint64
	err = tx.QueryRowContext(ctx, `UPDATE tasks SET state='dispatched',attempt=attempt+1,lease_until=?,updated_at=? WHERE id=(SELECT t.id FROM tasks t JOIN engine_operations o ON o.task_id=t.id JOIN nodes n ON n.id=t.node_id WHERE t.node_id=? AND n.state='online' AND n.engine_capable=1 AND o.active=1 AND NOT EXISTS(SELECT 1 FROM tasks busy WHERE busy.node_id=t.node_id AND busy.state IN ('dispatched','accepted','running') AND busy.lease_until>?) AND t.state IN ('queued','dispatched','accepted') AND (t.lease_until IS NULL OR t.lease_until<=?) AND t.deadline_at>? AND t.attempt<t.max_attempts ORDER BY t.created_at,t.id LIMIT 1) RETURNING id,task_type,idempotency_key,attempt,deadline_at`, at(time.Now().Add(45*time.Second)), now(), node, now(), now(), now()).Scan(&d.TaskID, &d.Operation, &d.IdempotencyKey, &attempt, &deadline)
	if errors.Is(err, sql.ErrNoRows) {
		var changesAfter int64
		if err = tx.QueryRowContext(ctx, `SELECT total_changes()`).Scan(&changesAfter); err != nil {
			return nil, err
		}
		if changesAfter != changesBefore {
			return nil, s.commitChanges(tx, realtime.Change{Kind: "node", NodeID: node}, realtime.Change{Kind: "tasks", NodeID: node})
		}
		return nil, tx.Commit()
	}
	if err != nil {
		return nil, err
	}
	if err = tx.QueryRowContext(ctx, `SELECT engine_id,command_encrypted FROM engine_operations WHERE task_id=?`, d.TaskID).Scan(&d.ResourceID, &encrypted); err != nil {
		return nil, err
	}
	b, err := s.openEngine(d.ResourceID, encrypted)
	if err != nil {
		return nil, err
	}
	if err = json.Unmarshal(b, &d.Engine); err != nil {
		return nil, err
	}
	hash := sha256.Sum256(b)
	d.ConfigSHA256 = hex.EncodeToString(hash[:])
	d.ResourceKind = "engine"
	d.Attempt = &attempt
	d.DeadlineAt, err = time.Parse(time.RFC3339Nano, deadline)
	if err != nil {
		return nil, err
	}
	if err = s.commitChanges(tx, realtime.Change{Kind: "tasks", NodeID: node}); err != nil {
		return nil, err
	}
	return &d, nil
}
func (s *Store) ReplyEngine(ctx context.Context, node, kind string, v v1.TaskReply) error {
	if v.Attempt == 0 || v.Inspection != nil || v.TrafficCalibration != nil || v.TrafficBefore != nil {
		return auth.ErrInvalid
	}
	if kind == "task.ack" && v.State != "accepted" || kind == "task.result" && v.State != "succeeded" && v.State != "failed" {
		return auth.ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var state, id, name, operation, encrypted, creds, snapshot, request string
	var revision, attempt uint64
	var draftVersion int64
	err = tx.QueryRowContext(ctx, `SELECT t.state,t.attempt,o.engine_id,e.name,o.operation,o.revision,o.draft_version,o.command_encrypted,o.credential_encrypted,o.public_snapshot,o.request_json FROM tasks t JOIN engine_operations o ON o.task_id=t.id JOIN engines e ON e.id=o.engine_id WHERE t.id=? AND t.node_id=?`, v.TaskID, node).Scan(&state, &attempt, &id, &name, &operation, &revision, &draftVersion, &encrypted, &creds, &snapshot, &request)
	if errors.Is(err, sql.ErrNoRows) {
		return auth.ErrNotFound
	}
	if err != nil {
		return err
	}
	if v.ResourceID != id || v.Attempt != attempt {
		return auth.ErrConflict
	}
	if state == "succeeded" || state == "failed" || state == "cancelled" {
		return tx.Commit()
	}
	if state != "dispatched" && state != "accepted" {
		return auth.ErrConflict
	}
	if kind == "task.ack" {
		if v.Engine != nil || v.ErrorCode != "" {
			return auth.ErrInvalid
		}
		_, err = tx.ExecContext(ctx, `UPDATE tasks SET state='accepted',updated_at=? WHERE id=?`, now(), v.TaskID)
		if err != nil {
			return err
		}
		return tx.Commit()
	}
	if v.Engine == nil || v.Engine.Name != name || v.Engine.Revision != revision {
		return auth.ErrInvalid
	}
	b, err := s.openEngine(id, encrypted)
	if err != nil {
		return err
	}
	var command v1.EngineCommand
	if err = json.Unmarshal(b, &command); err != nil {
		return err
	}
	result := v.Engine
	if v.State == "succeeded" {
		if result.Version != command.Version || result.ErrorCode != "" || v.ErrorCode != "" {
			return auth.ErrInvalid
		}
		valid := false
		switch operation {
		case "engine.install", "engine.upgrade":
			valid = result.Status == "installed" || result.Status == "stopped" || result.Status == "running"
		case "engine.uninstall":
			valid = result.Status == "not_installed"
		case "engine.stop":
			valid = result.Status == "stopped"
		case "engine.start":
			valid = result.Status == "running"
		case "engine.apply":
			valid = result.Status == "running" || result.Status == "stopped"
		case "engine.inspect":
			valid = result.Status == "running" || result.Status == "stopped" || result.Status == "installed" || result.Status == "not_installed"
		}
		if !valid || command.RunIntent == "stopped" && result.Status == "running" {
			return auth.ErrInvalid
		}
		if operation == "engine.inspect" {
			if _, err = tx.ExecContext(ctx, `UPDATE engines SET observed_at=?,status=? WHERE id=?`, now(), result.Status, id); err != nil {
				return err
			}
		} else if _, err = tx.ExecContext(ctx, `UPDATE engines SET observed_at=?,observed_revision=?,version=?,status=?,run_intent=? WHERE id=? AND observed_revision<?`, now(), revision, result.Version, result.Status, command.RunIntent, id, revision); err != nil {
			return err
		}
		if operation == "engine.uninstall" {
			var action proxy.Action
			if err = json.Unmarshal([]byte(request), &action); err != nil {
				return err
			}
			if action.DeleteServices {
				if _, err = tx.ExecContext(ctx, `UPDATE engine_drafts SET services_json='[]',version=version+1,updated_at=? WHERE engine_id=?`, now(), id); err != nil {
					return err
				}
				if _, err = tx.ExecContext(ctx, `DELETE FROM engine_credentials WHERE engine_id=?`, id); err != nil {
					return err
				}
				if _, err = tx.ExecContext(ctx, `DELETE FROM engine_port_reservations WHERE engine_id=?`, id); err != nil {
					return err
				}
			}
		}
		if operation == "engine.apply" {
			if _, err = tx.ExecContext(ctx, `INSERT INTO engine_credentials(engine_id,encrypted) VALUES(?,?) ON CONFLICT(engine_id) DO UPDATE SET encrypted=excluded.encrypted`, id, creds); err != nil {
				return err
			}
			// Only clean pending deletion when the draft itself has not changed since submission.
			var current int64
			if err = tx.QueryRowContext(ctx, `SELECT version FROM engine_drafts WHERE engine_id=?`, id).Scan(&current); err != nil {
				return err
			}
			if current == draftVersion && revision == command.Revision {
				var targetRevision int64
				if err = tx.QueryRowContext(ctx, `SELECT coalesce(max(revision),0) FROM engine_targets WHERE engine_id=?`, id).Scan(&targetRevision); err != nil {
					return err
				}
				if targetRevision > int64(revision) {
					current = -1
				}
			}
			if current == draftVersion {
				var draft proxy.Draft
				if err = json.Unmarshal([]byte(snapshot), &draft); err != nil {
					return err
				}
				retained := []proxy.Service{}
				for _, service := range draft.Services {
					if !service.PendingDelete {
						retained = append(retained, service)
					} else {
						if _, err = tx.ExecContext(ctx, `DELETE FROM engine_port_reservations WHERE engine_id=? AND service_id=?`, id, service.ID); err != nil {
							return err
						}
					}
				}
				if _, err = tx.ExecContext(ctx, `DELETE FROM engine_port_reservations WHERE engine_id=?`, id); err != nil {
					return err
				}
				for _, service := range retained {
					if _, err = tx.ExecContext(ctx, `INSERT INTO engine_port_reservations(node_id,engine_id,service_id,listen_host,listen_port) VALUES(?,?,?,?,?)`, node, id, service.ID, service.ListenHost, service.ListenPort); err != nil {
						return err
					}
				}
				raw, err := json.Marshal(retained)
				if err != nil {
					return err
				}
				routingRaw, err := json.Marshal(draft.Routing)
				if err != nil {
					return err
				}
				if _, err = tx.ExecContext(ctx, `UPDATE engine_drafts SET services_json=?,routing_json=?,version=version+1 WHERE engine_id=? AND version=?`, string(raw), string(routingRaw), id, draftVersion); err != nil {
					return err
				}
			}
		}
	} else {
		if !v1.EngineErrorCode(result.ErrorCode) || v.ErrorCode != result.ErrorCode {
			return auth.ErrInvalid
		}
		status := result.Status
		if status != "degraded" && status != "unknown" && status != "not_installed" && status != "stopped" && status != "running" && status != "installed" {
			return auth.ErrInvalid
		}
		if _, err = tx.ExecContext(ctx, `UPDATE engines SET status=? WHERE id=? AND observed_revision<?`, status, id, revision); err != nil {
			return err
		}
	}
	if v.State == "failed" {
		if operation == "engine.start" || operation == "engine.stop" {
			if _, err = tx.ExecContext(ctx, `UPDATE engine_targets SET sync_error=? WHERE engine_id=? AND revision>?`, result.ErrorCode, id, revision); err != nil {
				return err
			}
		}
		if _, err = tx.ExecContext(ctx, `UPDATE engine_targets SET sync_error=? WHERE engine_id=? AND revision=?`, result.ErrorCode, id, revision); err != nil {
			return err
		}
	} else if operation == "engine.apply" {
		if _, err = tx.ExecContext(ctx, `UPDATE engine_targets SET sync_error='' WHERE engine_id=? AND revision=?`, id, revision); err != nil {
			return err
		}
	} else if operation != "engine.inspect" {
		target, readErr := s.readTarget(ctx, tx, id)
		if readErr != nil && !errors.Is(readErr, sql.ErrNoRows) {
			return readErr
		}
		if readErr == nil {
			if operation == "engine.uninstall" {
				if _, err = tx.ExecContext(ctx, `DELETE FROM engine_targets WHERE engine_id=?`, id); err != nil {
					return err
				}
			} else {
				target.Command.RunIntent = command.RunIntent
				target.Command.Version = command.Version
				if target.Revision < int64(revision) {
					target.Revision = int64(revision)
				}
				if err = s.writeTarget(ctx, tx, target, false); err != nil {
					return err
				}
			}
		}
	}
	raw, err := json.Marshal(v)
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE tasks SET state=?,result_json=?,updated_at=? WHERE id=?`, v.State, string(raw), now(), v.TaskID); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE engine_operations SET active=0 WHERE task_id=?`, v.TaskID); err != nil {
		return err
	}
	if v.State == "succeeded" && operation == "engine.apply" {
		if err = refreshEngineReservations(ctx, tx, id, node); err != nil {
			return err
		}
	}
	return s.commitChanges(tx, realtime.Change{Kind: "tasks", NodeID: node}, realtime.Change{Kind: "node", NodeID: node})
}
