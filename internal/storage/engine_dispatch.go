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
	return s.ClaimEngineOperations(ctx, node, false)
}

func (s *Store) ClaimEngineOperations(ctx context.Context, node string, sessionSupportsSS bool) (*v1.TaskDispatch, error) {
	return s.ClaimNegotiatedEngines(ctx, node, sessionSupportsSS, false)
}
func (s *Store) ClaimNegotiatedEngines(ctx context.Context, node string, sessionSupportsSS, probe bool) (*v1.TaskDispatch, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `UPDATE nodes SET state=state WHERE id=?`, node); err != nil {
		return nil, err
	}
	if err = activateRelayWithdrawals(ctx, tx, node); err != nil {
		return nil, err
	}
	checkQueued, err := s.queueReenrollmentCheck(ctx, tx, node)
	if err != nil {
		return nil, err
	}
	changed, err := s.reconcileEngineTargets(ctx, tx, node)
	if err != nil {
		return nil, err
	}
	var d v1.TaskDispatch
	var encrypted, deadline string
	var attempt uint64
	err = tx.QueryRowContext(ctx, `UPDATE tasks SET state='dispatched',attempt=attempt+1,lease_until=?,updated_at=? WHERE id=(SELECT t.id FROM tasks t JOIN engine_operations o ON o.task_id=t.id JOIN nodes n ON n.id=t.node_id WHERE t.node_id=? AND n.state='online' AND n.engine_capable=1 AND (o.requires_ss_outbound=0 OR (n.ss_outbound_capable=1 AND ?=1)) AND (?=1 OR NOT EXISTS(SELECT 1 FROM relay_probe_tasks p WHERE p.task_id=t.id)) AND o.active=1 AND NOT EXISTS(SELECT 1 FROM tasks busy WHERE busy.node_id=t.node_id AND busy.state IN ('dispatched','accepted','running') AND (busy.lease_until>? OR busy.task_type='agent.update')) AND t.state IN ('queued','dispatched','accepted') AND (t.lease_until IS NULL OR t.lease_until<=?) AND t.deadline_at>? AND t.attempt<t.max_attempts ORDER BY t.created_at,t.id LIMIT 1) RETURNING id,task_type,idempotency_key,attempt,deadline_at`, at(time.Now().Add(45*time.Second)), now(), node, sessionSupportsSS, probe, now(), now(), now()).Scan(&d.TaskID, &d.Operation, &d.IdempotencyKey, &attempt, &deadline)
	if errors.Is(err, sql.ErrNoRows) {
		if changed || checkQueued {
			return nil, s.commitChanges(tx, realtime.Change{Kind: "node", NodeID: node}, realtime.Change{Kind: "engines", NodeID: node}, realtime.Change{Kind: "tasks", NodeID: node})
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
	if err = s.commitChanges(tx, realtime.Change{Kind: "tasks", NodeID: node, TaskID: d.TaskID}, realtime.Change{Kind: "engines", NodeID: node, EngineID: d.ResourceID}); err != nil {
		return nil, err
	}
	return &d, nil
}
func (s *Store) ReplyEngine(ctx context.Context, node, kind string, v v1.TaskReply) error {
	if v.AgentUpdate != nil || v.Attempt == 0 || v.Inspection != nil || v.TrafficCalibration != nil || v.TrafficBefore != nil {
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
	if result.RelayProbe != nil && (v.State != "succeeded" || !v1.ValidRelayProbeResult(command.RelayProbe, result.RelayProbe)) || command.RelayProbe != nil && v.State == "succeeded" && (result.Status != "running" || result.RelayProbe == nil) {
		return auth.ErrInvalid
	}
	var recoveryActor, recoveryReason string
	var recoverySealed string
	if !command.RecoveryCheck && (result.Recovery != nil || result.RecoveryRevision != nil) || v.State != "succeeded" && (result.Recovery != nil || result.RecoveryRevision != nil) {
		return auth.ErrInvalid
	}
	if command.RecoveryCheck && v.State == "succeeded" {
		if operation != "engine.inspect" || command.IncludeConfig || result.Configuration != nil || result.RecoveryRevision == nil || *result.RecoveryRevision > 1<<53-1 {
			return auth.ErrInvalid
		}
		if result.Recovery == nil && result.Status != "not_installed" || result.Recovery != nil && (result.Recovery.Status != result.Status || result.Recovery.Command == nil || result.Recovery.Command.Name != name || result.Recovery.Command.Revision != *result.RecoveryRevision || v1.ValidateRecoveryObservation(id, result.Recovery) != nil) {
			return auth.ErrInvalid
		}
		var recoveryState, recoveryTask string
		if err = tx.QueryRowContext(ctx, `SELECT state,task_id,requested_by,reason FROM subscription_restore_engines WHERE engine_id=?`, id).Scan(&recoveryState, &recoveryTask, &recoveryActor, &recoveryReason); err != nil {
			return err
		}
		if recoveryState != "pending" || recoveryTask != v.TaskID || recoveryActor == "" {
			return auth.ErrConflict
		}
	}
	if result.Configuration != nil {
		if operation != "engine.inspect" || !command.IncludeConfig || v.State != "succeeded" || result.Configuration.Revision > revision || v1.ValidateEngineConfiguration(name, result.Configuration) != nil {
			return auth.ErrInvalid
		}
	}
	if v.State == "succeeded" && command.IncludeConfig && result.Configuration == nil {
		return auth.ErrInvalid
	}
	if !v1.ValidEngineDiagnostic(result.Diagnostic) || (v.State == "succeeded" && result.Diagnostic != nil) || (result.Diagnostic != nil && result.Diagnostic.Interrupted && result.ErrorCode != "engine_result_unknown") {
		return auth.ErrInvalid
	}
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
		if !valid || !command.RecoveryCheck && command.RunIntent == "stopped" && result.Status == "running" {
			return auth.ErrInvalid
		}
		if command.RecoveryCheck && result.Recovery == nil {
			if err = engineAccess(ctx, tx, recoveryActor, node, true); err == nil {
				if _, err = tx.ExecContext(ctx, `DELETE FROM engine_targets WHERE engine_id=?`, id); err != nil {
					return err
				}
				if _, err = tx.ExecContext(ctx, `DELETE FROM engine_credentials WHERE engine_id=?`, id); err != nil {
					return err
				}
				if _, err = tx.ExecContext(ctx, `UPDATE subscription_service_links SET invalidated=1 WHERE node_id=? AND engine_id=?`, node, id); err != nil {
					return err
				}
				if _, err = tx.ExecContext(ctx, `DELETE FROM subscription_restore_endpoints WHERE engine_id=?`, id); err != nil {
					return err
				}
				if _, err = tx.ExecContext(ctx, `UPDATE subscription_restore_engines SET state='matched',observed_encrypted='',observed_revision=?,draft_needs_review=CASE WHEN reason='reenrollment' THEN 0 ELSE 1 END WHERE engine_id=? AND task_id=?`, *result.RecoveryRevision, id, v.TaskID); err != nil {
					return err
				}
				// Fence publications preceding this check. Its wire revision is
				// also available to the next operation that changes the engine.
				if _, err = tx.ExecContext(ctx, `UPDATE engines SET status='not_installed',version=NULL,run_intent='stopped',last_absent_revision=?,observed_revision=?,desired_revision=max(desired_revision,?),observed_at=? WHERE id=?`, revision-1, *result.RecoveryRevision, *result.RecoveryRevision, now(), id); err != nil {
					return err
				}
				if err = audit(ctx, tx, recoveryActor, "subscription.recovery.absent", "engine", id); err != nil {
					return err
				}
			} else if !errors.Is(err, proxy.ErrForbidden) {
				return err
			}
		}
		if result.Recovery != nil {
			observedRaw, err := json.Marshal(result.Recovery)
			if err != nil {
				return err
			}
			observedSealed, err := s.sealEngine(id, observedRaw)
			if err != nil {
				return err
			}
			recoverySealed = observedSealed
			if _, err = tx.ExecContext(ctx, `UPDATE subscription_restore_engines SET state='mismatch',observed_encrypted=?,observed_revision=? WHERE engine_id=? AND task_id=? AND state='pending'`, observedSealed, result.Recovery.Command.Revision, id, v.TaskID); err != nil {
				return err
			}
			if recoveryReason == "reenrollment" {
				if err = engineAccess(ctx, tx, recoveryActor, node, true); err == nil {
					if err = s.confirmReenrolledEngine(ctx, tx, id, result.Recovery); err != nil {
						return err
					}
				} else if !errors.Is(err, proxy.ErrForbidden) {
					return err
				}
			} else if err = s.matchRestoredEngine(ctx, tx, recoveryActor, node, id, result.Recovery); err != nil {
				return err
			}
			if _, err = tx.ExecContext(ctx, `UPDATE engines SET version=? WHERE id=?`, result.Recovery.Command.Version, id); err != nil {
				return err
			}
		}
		if operation == "engine.inspect" {
			if _, err = tx.ExecContext(ctx, `UPDATE engines SET observed_at=?,status=? WHERE id=?`, now(), result.Status, id); err != nil {
				return err
			}
		} else if _, err = tx.ExecContext(ctx, `UPDATE engines SET observed_at=?,observed_revision=?,version=?,status=?,run_intent=? WHERE id=? AND observed_revision<?`, now(), revision, result.Version, result.Status, command.RunIntent, id, revision); err != nil {
			return err
		}
		if operation == "engine.uninstall" {
			if _, err = tx.ExecContext(ctx, `UPDATE subscription_service_links SET invalidated=1 WHERE node_id=? AND engine_id=?`, node, id); err != nil {
				return err
			}
			var action proxy.Action
			if err = json.Unmarshal([]byte(request), &action); err != nil {
				return err
			}
			if action.DeleteServices {
				if _, err = tx.ExecContext(ctx, `UPDATE engine_drafts SET services_json='[]',version=version+1,updated_at=? WHERE engine_id=? AND json_array_length(services_json)>0`, now(), id); err != nil {
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
			services, err := json.Marshal(command.Services)
			if err != nil {
				return err
			}
			if _, err = tx.ExecContext(ctx, `UPDATE subscription_service_links SET invalidated=1 WHERE node_id=? AND engine_id=? AND invalidated=0 AND NOT EXISTS(SELECT 1 FROM relay_routes r WHERE r.engine_id=subscription_service_links.engine_id AND r.id=subscription_service_links.service_id) AND NOT EXISTS(SELECT 1 FROM json_each(?) v WHERE json_extract(v.value,'$.id')=subscription_service_links.service_id)`, node, id, string(services)); err != nil {
				return err
			}
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
				// Stored drafts and snapshots share JSON encoding. Empty service lists
				// may be null or []; neither a confirmation nor normalization is an edit.
				if _, err = tx.ExecContext(ctx, `UPDATE engine_drafts SET services_json=?,routing_json=?,version=version+1,updated_at=? WHERE engine_id=? AND version=? AND (coalesce(nullif(services_json,'null'),'[]')!=? OR routing_json!=?)`, string(raw), string(routingRaw), now(), id, draftVersion, string(raw), string(routingRaw)); err != nil {
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
		if command.RecoveryCheck {
			status = "unknown"
		}
		if _, err = tx.ExecContext(ctx, `UPDATE engines SET status=? WHERE id=? AND observed_revision<?`, status, id, revision); err != nil {
			return err
		}
	}
	if v.State == "failed" && operation != "engine.inspect" {
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
	stored := engineConfigurationReply{TaskReply: v, RecoveryEncrypted: recoverySealed}
	if result.Configuration != nil {
		content, err := json.Marshal(result.Configuration)
		if err != nil {
			return err
		}
		stored.ConfigurationEncrypted, err = s.sealEngine(id, content)
		if err != nil {
			return err
		}
		publicResult := *result
		publicResult.Configuration = nil
		stored.Engine = &publicResult
	}
	if result.Recovery != nil {
		publicResult := *result
		publicResult.Recovery = nil
		stored.Engine = &publicResult
	}
	raw, err := json.Marshal(stored)
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
		// The first successful publication after a confirmed absence supplies
		// fresh credentials and makes the new endpoints exportable again.
		if _, err = tx.ExecContext(ctx, `DELETE FROM subscription_restore_engines WHERE engine_id=? AND reason='reenrollment' AND state='matched' AND observed_encrypted='' AND draft_needs_review=0`, id); err != nil {
			return err
		}
	}
	if v.State == "succeeded" && (operation == "engine.apply" || command.RecoveryCheck && result.Recovery == nil) {
		if _, err = tx.ExecContext(ctx, `DELETE FROM relay_public_bindings WHERE route_id IN (SELECT p.route_id FROM relay_publications p JOIN relay_routes r ON r.id=p.route_id AND r.target_revision=p.revision WHERE p.task_id=? AND (p.operation='withdraw' OR host!=json_extract(p.path_json,'$.public.host') OR port!=CAST(json_extract(p.path_json,'$.public.port') AS INTEGER)))`, v.TaskID); err != nil {
			return err
		}
		if err = refreshEngineReservations(ctx, tx, id, node); err != nil {
			return err
		}
	}
	return s.commitChanges(tx, realtime.Change{Kind: "tasks", NodeID: node, TaskID: v.TaskID}, realtime.Change{Kind: "node", NodeID: node}, realtime.Change{Kind: "engines", NodeID: node, EngineID: v.ResourceID})
}
