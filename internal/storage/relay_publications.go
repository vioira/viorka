package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"slices"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/proxy"
	"github.com/vioira/viorka/internal/realtime"
	"github.com/vioira/viorka/internal/scheduler"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func mergeRelayRule(services []proxy.Service, rule proxy.Service, withdraw bool) []proxy.Service {
	merged := slices.Clone(services)
	for i, v := range merged {
		if v.ID == rule.ID {
			if withdraw {
				return slices.Delete(merged, i, i+1)
			}
			merged[i] = rule
			return merged
		}
	}
	if !withdraw {
		merged = append(merged, rule)
	}
	return merged
}
func relayPublishBase(e proxy.Engine) *proxy.RelayPublishBase {
	if e.ActiveTaskState != "" || e.PublishedRevision > e.ObservedRevision && e.SyncError == "" {
		return nil
	}
	return &proxy.RelayPublishBase{Revision: e.DesiredRevision, DraftVersion: e.Draft.Version, StartsRealm: e.Status != "running" || e.RunIntent != "running"}
}

func (s *Store) PublishRelay(ctx context.Context, actor, id string, input proxy.RelayPublishRequest) (scheduler.Task, error) {
	if input.Review == nil {
		return scheduler.Task{}, proxy.ErrInvalid
	}
	return s.submitRelay(ctx, actor, id, "publish", input.RelayAction, input.Review)
}

func (s *Store) WithdrawRelay(ctx context.Context, actor, id string, input proxy.RelayAction) (scheduler.Task, error) {
	return s.submitRelay(ctx, actor, id, "withdraw", input, nil)
}

func (s *Store) submitRelay(ctx context.Context, actor, id, operation string, input proxy.RelayAction, review *proxy.RelayPublishBase) (scheduler.Task, error) {
	var empty scheduler.Task
	if !proxy.ValidID(input.RequestKey) || input.Version < 1 {
		return empty, proxy.ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return empty, err
	}
	defer tx.Rollback()
	var engine string
	err = tx.QueryRowContext(ctx, `SELECT engine_id FROM relay_routes WHERE id=? AND deleted=0`, id).Scan(&engine)
	if errors.Is(err, sql.ErrNoRows) {
		return empty, auth.ErrNotFound
	}
	if err != nil {
		return empty, err
	}
	if err = lockRelayEngine(ctx, tx, engine); err != nil {
		return empty, err
	}
	e, err := relayEngine(ctx, tx, engine)
	if err != nil {
		return empty, err
	}
	if err = engineAccess(ctx, tx, actor, e.NodeID, true); err != nil {
		return empty, err
	}
	var raw, stopped string
	var version, last int64
	if err = tx.QueryRowContext(ctx, `SELECT draft_json,draft_version,target_revision,stopped_at FROM relay_routes WHERE id=? AND deleted=0`, id).Scan(&raw, &version, &last, &stopped); err != nil {
		return empty, err
	}
	var path relayPath
	if err = json.Unmarshal([]byte(raw), &path); err != nil {
		return empty, err
	}
	withdraw := operation == "withdraw"
	alreadyApplied := false
	if !withdraw {
		view, _, err := s.relayDetailTx(ctx, tx, actor, id, false)
		if err != nil {
			return empty, err
		}
		if view.CleanupOnly {
			return empty, proxy.ErrForbidden
		}
		alreadyApplied = view.Published != nil && view.Published.Version == version && view.TaskState == "succeeded" && view.CanTestPublic()
	}
	var prev, prevOp string
	var prevVersion int64
	err = tx.QueryRowContext(ctx, `SELECT task_id,operation,draft_version FROM relay_publications WHERE route_id=? AND request_key=?`, id, input.RequestKey).Scan(&prev, &prevOp, &prevVersion)
	if err == nil {
		if prevOp != operation || prevVersion != input.Version {
			return empty, proxy.ErrConflict
		}
		tx.Rollback()
		return s.Task(ctx, prev)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return empty, err
	}
	if version != input.Version {
		return empty, proxy.ErrRelayRevision
	}
	if alreadyApplied {
		return empty, proxy.ErrRelayApplied
	}
	if !withdraw {
		if err = relayEngineReady(ctx, tx, e); err != nil {
			return empty, err
		}
		if base := relayPublishBase(e); base == nil || *review != *base {
			return empty, proxy.ErrRelayRevision
		}
		current, _, err := relayLanding(ctx, s, tx, actor, path.RelayEdit)
		if err != nil {
			return empty, err
		}
		if current.Fingerprint != path.Fingerprint || current.LandingRevision != path.LandingRevision {
			return empty, proxy.ErrRelayLanding
		}
		if err = s.lockPublicEndpoints(ctx, tx, []proxy.Service{path.rule(id)}); err != nil {
			return empty, err
		}
		if err = relayMapping(ctx, tx, id, e.NodeID, path); err != nil {
			return empty, err
		}
		res, err := tx.ExecContext(ctx, `INSERT INTO relay_public_bindings(host,port,route_id) VALUES(?,?,?) ON CONFLICT(host,port) DO UPDATE SET route_id=excluded.route_id WHERE relay_public_bindings.route_id=excluded.route_id`, path.Public.Host, path.Public.Port, id)
		if err != nil {
			return empty, err
		}
		n, err := res.RowsAffected()
		if err != nil {
			return empty, err
		}
		if n != 1 {
			return empty, proxy.ErrRelayMapping
		}
	} else if last == 0 {
		return empty, proxy.ErrConflict
	}
	if withdraw && stopped != "" {
		var state string
		if err = tx.QueryRowContext(ctx, `SELECT t.state FROM relay_publications p JOIN tasks t ON t.id=p.task_id WHERE p.route_id=? AND p.revision=?`, id, last).Scan(&state); err != nil {
			return empty, err
		}
		if state != "failed" && state != "cancelled" {
			return empty, proxy.ErrConflict
		}
	}
	target, err := s.readTarget(ctx, tx, engine)
	if errors.Is(err, sql.ErrNoRows) {
		target = engineTarget{ID: engine, Node: e.NodeID, Credentials: map[string]engineCredential{}}
	} else if err != nil {
		return empty, err
	}
	rule := path.rule(id)
	target.Actor, target.Error, target.Revision = actor, "", e.DesiredRevision+1
	target.Draft.Services = mergeRelayRule(target.Draft.Services, rule, withdraw)
	cmd := v1.EngineCommand{Name: "realm", Version: e.Version, RunIntent: e.RunIntent, Revision: uint64(target.Revision), Services: []*v1.EngineService{}}
	if !withdraw {
		cmd.RunIntent = "running"
	}
	for _, v := range target.Draft.Services {
		cmd.Services = append(cmd.Services, &v1.EngineService{ID: v.ID, Name: v.Name, ListenHost: v.ListenHost, ListenPort: uint64(v.ListenPort), TargetHost: v.TargetHost, TargetPort: uint64(v.TargetPort), Enabled: v.Enabled, ShortIds: []string{}})
	}
	target.Command = cmd
	if err = checkTargetPorts(ctx, tx, target); err != nil {
		return empty, err
	}
	if err = reserveTarget(ctx, tx, target); err != nil {
		return empty, err
	}
	// Merge into the operator's working copy independently. Publishing a relay
	// must never push unrelated, unsubmitted edits from that working copy.
	e.Draft.Services = mergeRelayRule(e.Draft.Services, rule, withdraw)
	if err = proxy.ValidateDraft("realm", e.Draft); err != nil {
		return empty, err
	}
	e.Draft.Version++
	target.Draft.Version = e.Draft.Version
	services, err := json.Marshal(e.Draft.Services)
	if err != nil {
		return empty, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO engine_drafts(engine_id,version,services_json,updated_by,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(engine_id) DO UPDATE SET version=excluded.version,services_json=excluded.services_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at`, engine, e.Draft.Version, string(services), actor, now()); err != nil {
		return empty, err
	}
	if err = s.writeTarget(ctx, tx, target, false); err != nil {
		return empty, err
	}
	a := proxy.Action{Operation: "engine.apply", Confirm: true, DraftVersion: e.Draft.Version, IdempotencyKey: "relay-" + digestJSON([]string{id, input.RequestKey})}
	request, err := json.Marshal(a)
	if err != nil {
		return empty, err
	}
	appliedDraft := target.Draft
	appliedDraft.Version = -1 // The target does not own unrelated, unpublished edits in engine_drafts.
	task, err := s.queueEngineOperation(ctx, tx, actor, e.NodeID, engine, a, cmd, appliedDraft, target.Credentials, request, !withdraw)
	if err != nil {
		return empty, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO relay_publications(route_id,revision,draft_version,path_json,task_id,operation,request_key,admin_reviewed_port) VALUES(?,?,?,?,?,?,?,(SELECT CASE WHEN role='admin' THEN 1 ELSE 0 END FROM users WHERE id=?))`, id, target.Revision, version, raw, task, operation, input.RequestKey, actor); err != nil {
		return empty, err
	}
	if !withdraw {
		if _, err = tx.ExecContext(ctx, `INSERT INTO relay_public_probes(route_id,revision,epoch,host,port,requested_by,check_id,state,due_at)
    SELECT id,?,verify_after,?,?,?,?, 'queued',? FROM relay_routes WHERE id=?`, target.Revision, path.Public.Host, path.Public.Port, actor, auth.Random(), now(), id); err != nil {
			return empty, err
		}
	}
	stopped = ""
	if withdraw {
		stopped = now()
	}
	if _, err = tx.ExecContext(ctx, `UPDATE relay_routes SET target_revision=?,stopped_at=?,confirmed_revision=CASE WHEN ?=1 THEN 0 ELSE confirmed_revision END WHERE id=?`, target.Revision, stopped, withdraw, id); err != nil {
		return empty, err
	}
	if err = audit(ctx, tx, actor, "relay."+operation, "relay", id); err != nil {
		return empty, err
	}
	if err = s.commitChanges(tx, realtime.Change{Kind: "engines", NodeID: e.NodeID, EngineID: engine}, realtime.Change{Kind: "tasks", NodeID: e.NodeID, TaskID: task}); err != nil {
		return empty, err
	}
	return s.Task(ctx, task)
}
func engineAccessForLanding(ctx context.Context, tx *sql.Tx, actor, engine string) error {
	var node string
	if err := tx.QueryRowContext(ctx, `SELECT node_id FROM engines WHERE id=?`, engine).Scan(&node); err != nil {
		return err
	}
	return subscriptionExportAccessTx(ctx, tx, actor, node)
}

// Bring a deferred removal into the ordinary engine queue only after its
// predecessor has terminated. Offline time does not consume the execution deadline.
func activateRelayWithdrawals(ctx context.Context, tx *sql.Tx, node string) error {
	var task string
	err := tx.QueryRowContext(ctx, `SELECT o.task_id FROM engine_operations o JOIN tasks t ON t.id=o.task_id JOIN relay_publications p ON p.task_id=t.id JOIN engines e ON e.id=o.engine_id WHERE t.node_id=? AND t.state='queued' AND o.active=0 AND e.status IN ('running','installed','stopped') AND NOT EXISTS(SELECT 1 FROM subscription_restore_engines z WHERE z.engine_id=e.id AND z.state!='matched') AND p.operation='withdraw' AND NOT EXISTS(SELECT 1 FROM engine_operations b WHERE b.engine_id=o.engine_id AND b.active=1) ORDER BY o.revision LIMIT 1`, node).Scan(&task)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE engine_operations SET active=1 WHERE task_id=?`, task); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE tasks SET deadline_at=? WHERE id=?`, at(time.Now().Add(5*time.Minute)), task)
	return err
}

func protectRelayRules(ctx context.Context, tx *sql.Tx, engine string, d proxy.Draft) error {
	rows, err := tx.QueryContext(ctx, `SELECT r.id,coalesce(p.operation,''),coalesce(p.path_json,'') FROM relay_routes r LEFT JOIN relay_publications p ON p.route_id=r.id AND p.revision=r.target_revision WHERE r.engine_id=? AND r.deleted=0`, engine)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id, op, raw string
		if err = rows.Scan(&id, &op, &raw); err != nil {
			return err
		}
		var path relayPath
		if op == "publish" {
			if err = json.Unmarshal([]byte(raw), &path); err != nil {
				return err
			}
		}
		i := slices.IndexFunc(d.Services, func(s proxy.Service) bool { return s.ID == id })
		if op == "publish" && (i < 0 || d.Services[i] != path.rule(id)) || op != "publish" && i >= 0 {
			return proxy.ErrRelayRule
		}
	}
	return rows.Err()
}
