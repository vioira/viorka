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
	"github.com/vioira/viorka/internal/subscription"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func (s *Store) ProbeRelay(ctx context.Context, actor, id string, input proxy.RelayAction) (scheduler.Task, error) {
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
	r, _, err := s.relayDetailTx(ctx, tx, actor, id, false)
	if err != nil {
		return empty, err
	}
	if !r.CanManage || r.CleanupOnly {
		return empty, proxy.ErrForbidden
	}
	var prev string
	var revision int64
	err = tx.QueryRowContext(ctx, `SELECT task_id,revision FROM relay_probe_tasks WHERE route_id=? AND request_key=?`, id, input.RequestKey).Scan(&prev, &revision)
	if err == nil {
		if revision != input.Version {
			return empty, proxy.ErrConflict
		}
		tx.Rollback()
		return s.Task(ctx, prev)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return empty, err
	}
	if !r.ProbeCapable {
		return empty, proxy.ErrUnavailable
	}
	if !r.AppliedRunning || r.TargetRevision != input.Version || !r.CanTestPublic() && r.Reason != "probe_unconfirmed" {
		return empty, proxy.ErrRelayRevision
	}
	var busy bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM engine_operations o JOIN tasks t ON t.id=o.task_id WHERE o.engine_id=? AND (o.active=1 OR t.state='queued')) OR EXISTS(SELECT 1 FROM relay_probe_tasks p JOIN tasks t ON t.id=p.task_id WHERE p.route_id=? AND t.created_at>?)`, engine, id, at(time.Now().Add(-time.Minute))).Scan(&busy); err != nil {
		return empty, err
	}
	if busy {
		return empty, proxy.ErrConflict
	}
	e, err := relayEngine(ctx, tx, engine)
	if err != nil {
		return empty, err
	}
	// The wire command must be newer than the applied revision. Its revision
	// belongs to this inspect task and is not reserved as a configuration target.
	cmd := v1.EngineCommand{Name: "realm", Version: e.Version, Revision: uint64(e.DesiredRevision + 1), RunIntent: e.RunIntent, Services: []*v1.EngineService{}, RelayProbe: &v1.RelayProbe{RuleID: id, AppliedRevision: uint64(e.ObservedRevision)}}
	a := proxy.Action{Operation: "engine.inspect", Confirm: true, IdempotencyKey: "probe-" + digestJSON([]string{id, input.RequestKey})}
	raw, err := json.Marshal(a)
	if err != nil {
		return empty, err
	}
	task, err := s.queueEngineOperation(ctx, tx, actor, e.NodeID, engine, a, cmd, proxy.Draft{}, nil, raw, true)
	if err != nil {
		return empty, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO relay_probe_tasks(task_id,route_id,revision,requested_by,request_key) VALUES(?,?,?,?,?)`, task, id, input.Version, actor, input.RequestKey); err != nil {
		return empty, err
	}
	if err = audit(ctx, tx, actor, "relay.probe", "relay", id); err != nil {
		return empty, err
	}
	if err = s.commitChanges(tx, realtime.Change{Kind: "tasks", NodeID: e.NodeID, TaskID: task}, realtime.Change{Kind: "engines", NodeID: e.NodeID, EngineID: engine}); err != nil {
		return empty, err
	}
	return s.Task(ctx, task)
}

func latestRelayProbe(ctx context.Context, tx *sql.Tx, id string, revision int64) (*proxy.RelayProbeSummary, error) {
	var p proxy.RelayProbeSummary
	err := tx.QueryRowContext(ctx, `SELECT t.id,t.state,t.updated_at,coalesce(json_extract(t.result_json,'$.engine.relay_probe.listen'),''),coalesce(json_extract(t.result_json,'$.engine.relay_probe.dial'),''),coalesce(json_extract(t.result_json,'$.error_code'),t.last_error,'') FROM relay_probe_tasks p JOIN tasks t ON t.id=p.task_id WHERE p.route_id=? AND p.revision=? ORDER BY t.created_at DESC,t.id DESC LIMIT 1`, id, revision).Scan(&p.TaskID, &p.State, &p.At, &p.Listen, &p.Dial, &p.ErrorCode)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &p, err
}

func (s *Store) ScheduleRelayProbes(ctx context.Context, nowTime time.Time) error {
	// At most eight due routes per minute. Resolve the original publisher's
	// current grants again before scheduling through the manual probe path.
	after := ""
	if previous := s.relayProbeCursor.Load(); previous != nil {
		after = *previous
	}
	cutoff := at(nowTime.Add(-30 * time.Minute))
	rows, err := s.db.QueryContext(ctx, `SELECT r.id,r.target_revision,c.created_by
		FROM relay_routes r JOIN engines e ON e.id=r.engine_id JOIN nodes n ON n.id=e.node_id
		JOIN relay_publications p ON p.route_id=r.id AND p.revision=r.target_revision
		JOIN config_revisions c ON c.resource_kind='engine' AND c.resource_id=e.id AND c.revision=p.revision
		JOIN users u ON u.id=c.created_by JOIN engines l ON l.id=json_extract(p.path_json,'$.landing_engine_id')
		WHERE r.deleted=0 AND r.stopped_at='' AND r.confirmed_revision=r.target_revision AND u.disabled=0
		AND n.state='online' AND n.relay_probe_capable=1 AND e.status='running' AND p.operation='publish'
		AND (u.role='admin' OR (u.role='operator'
			AND EXISTS(SELECT 1 FROM engine_node_grants g WHERE g.user_id=u.id AND g.node_id=n.id AND g.can_manage=1)
			AND EXISTS(SELECT 1 FROM engine_node_grants g WHERE g.user_id=u.id AND g.node_id=l.node_id AND g.can_export=1)))
		AND NOT EXISTS(SELECT 1 FROM engine_operations o WHERE o.engine_id=e.id AND o.active=1)
		AND NOT EXISTS(SELECT 1 FROM relay_probe_tasks x JOIN tasks t ON t.id=x.task_id WHERE x.route_id=r.id AND t.created_at>?)
		AND c.created_at<? ORDER BY CASE WHEN r.id>? THEN 0 ELSE 1 END,r.id LIMIT 8`, cutoff, cutoff, after)
	if err != nil {
		return err
	}
	type due struct {
		id, actor string
		revision  int64
	}
	var items []due
	for rows.Next() {
		var d due
		if err = rows.Scan(&d.id, &d.revision, &d.actor); err != nil {
			rows.Close()
			return err
		}
		items = append(items, d)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, d := range items {
		// A temporarily ineligible route must not starve later IDs on every tick.
		s.relayProbeCursor.Store(&d.id)
		_, err = s.ProbeRelay(ctx, d.actor, d.id, proxy.RelayAction{Version: d.revision, RequestKey: auth.Random()})
		if err != nil && !errors.Is(err, proxy.ErrRelayRevision) && !errors.Is(err, proxy.ErrConflict) && !errors.Is(err, proxy.ErrUnavailable) && !errors.Is(err, proxy.ErrForbidden) && !errors.Is(err, subscription.ErrForbidden) && !errors.Is(err, auth.ErrNotFound) {
			return err
		}
	}
	return nil
}
