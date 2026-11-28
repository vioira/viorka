package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/netip"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/proxy"
	"github.com/vioira/viorka/internal/subscription"
)

func (s *Store) relayDetailTx(ctx context.Context, tx *sql.Tx, actor, id string, forExport bool) (proxy.RelayRoute, *subscription.ClientNode, error) {
	var r proxy.RelayRoute
	var draftRaw, pathRaw, operation, landingNode, status, syncError string
	var isolated bool
	var confirmed, absent int64
	var verifyAfter, reportedStatus string
	err := tx.QueryRowContext(ctx, `SELECT r.confirmed_revision,e.last_absent_revision,r.verify_after,n.state='online',coalesce(json_extract(t.result_json,'$.engine.status'),''),r.id,n.id,n.name,r.draft_json,r.target_revision,e.observed_revision,e.observed_at,r.stopped_at,e.status,l.node_id,(n.state='online' AND n.relay_probe_capable=1),coalesce(p.path_json,''),coalesce(p.operation,''),coalesce(p.task_id,''),coalesce(t.state,''),coalesce(t.updated_at,''),coalesce(json_extract(t.result_json,'$.error_code'),t.last_error,''),coalesce(et.sync_error,''),EXISTS(SELECT 1 FROM subscription_restore_engines z WHERE z.engine_id=e.id AND z.state!='matched') FROM relay_routes r JOIN engines e ON e.id=r.engine_id JOIN nodes n ON n.id=e.node_id JOIN engines l ON l.id=r.landing_engine_id LEFT JOIN relay_publications p ON p.route_id=r.id AND p.revision=r.target_revision LEFT JOIN tasks t ON t.id=p.task_id LEFT JOIN engine_targets et ON et.engine_id=e.id WHERE r.id=? AND r.deleted=0`, id).Scan(&confirmed, &absent, &verifyAfter, &r.Online, &reportedStatus, &r.ID, &r.EntryNode, &r.EntryName, &draftRaw, &r.TargetRevision, &r.ObservedRevision, &r.ObservedAt, &r.StoppedAt, &status, &landingNode, &r.ProbeCapable, &pathRaw, &operation, &r.TaskID, &r.TaskState, &r.TaskAt, &r.ErrorCode, &syncError, &isolated)
	if errors.Is(err, sql.ErrNoRows) {
		return r, nil, auth.ErrNotFound
	}
	if err != nil {
		return r, nil, err
	}
	if err = engineAccess(ctx, tx, actor, r.EntryNode, false); err != nil {
		return proxy.RelayRoute{}, nil, err
	}
	if err = engineAccess(ctx, tx, actor, r.EntryNode, true); err != nil && !errors.Is(err, proxy.ErrForbidden) {
		return r, nil, err
	}
	r.CanManage = err == nil
	var draft relayPath
	if err = json.Unmarshal([]byte(draftRaw), &draft); err != nil {
		return r, nil, err
	}
	var pub relayPath
	if pathRaw != "" {
		if err = json.Unmarshal([]byte(pathRaw), &pub); err != nil {
			return r, nil, err
		}
	}
	var landingAccess error
	if !forExport || pathRaw == "" {
		landingAccess = subscriptionExportAccessTx(ctx, tx, actor, landingNode)
	}
	if landingAccess == nil && pathRaw != "" {
		landingAccess = engineAccessForLanding(ctx, tx, actor, pub.LandingEngineID)
	}
	if landingAccess != nil {
		if !errors.Is(landingAccess, subscription.ErrForbidden) || forExport || !r.CanManage {
			return proxy.RelayRoute{}, nil, landingAccess
		}
		r.Draft = proxy.RelayPath{RelayEdit: proxy.RelayEdit{Name: draft.Name, Version: draft.Version, EngineID: draft.EngineID, Listen: draft.Listen, Public: draft.Public}}
		r.Reason = "permission_lost"
		r.CleanupOnly = true
		r.Affected = []string{}
		if r.StoppedAt != "" {
			r.Reason = "disabled"
			if operation == "withdraw" && r.TaskState == "succeeded" {
				r.RemovedAt = r.TaskAt
			}
		}
		return r, nil, nil
	}
	if r.CanManage && !forExport {
		entry, err := relayEngine(ctx, tx, draft.EngineID)
		if err != nil {
			return r, nil, err
		}
		r.PublishBase = relayPublishBase(entry)
	}
	r.Draft = draft.RelayPath
	r.Affected = []string{}
	rows, err := tx.QueryContext(ctx, `SELECT json_extract(p.path_json,'$.name') FROM relay_routes o JOIN relay_publications p ON p.route_id=o.id AND p.revision=o.target_revision WHERE o.engine_id=? AND o.id!=? AND o.deleted=0 AND p.operation='publish' ORDER BY o.id LIMIT 32`, draft.EngineID, id)
	if err != nil {
		return r, nil, err
	}
	for rows.Next() {
		var name string
		if err = rows.Scan(&name); err != nil {
			rows.Close()
			return r, nil, err
		}
		r.Affected = append(r.Affected, name)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return r, nil, err
	}
	if pathRaw == "" {
		r.Reason = "draft"
		return r, nil, nil
	}
	publishedPath := pub.RelayPath
	r.Published = &publishedPath
	r.Probe, err = latestRelayProbe(ctx, tx, id, r.TargetRevision)
	if err != nil {
		return r, nil, err
	}
	if r.StoppedAt != "" {
		r.Reason = "disabled"
		if operation == "withdraw" && r.TaskState == "succeeded" {
			r.RemovedAt = r.TaskAt
		}
		return r, nil, nil
	}
	if isolated {
		r.Reason = "restore_verification_required"
		return r, nil, nil
	}
	r.AppliedRunning = r.TaskState == "succeeded" && reportedStatus == "running" && r.ObservedRevision >= r.TargetRevision
	effectiveRevision := r.TargetRevision
	restored := false
	if r.TaskState == "failed" && confirmed > absent && confirmed < r.TargetRevision && status == "running" && reportedStatus == "running" && syncError == r.ErrorCode {
		previous, ok, err := s.rollbackRelayPath(ctx, tx, id, confirmed, pub, r.ErrorCode)
		if err != nil {
			return r, nil, err
		}
		if ok {
			pub = previous
			effectiveRevision = confirmed
			restored = true
		}
	}
	if !restored && (!r.AppliedRunning || absent >= r.TargetRevision) {
		r.Reason = "awaiting_apply"
		return r, nil, nil
	}
	if status != "running" || syncError != "" && !restored {
		r.Reason = "runtime_unconfirmed"
		return r, nil, nil
	}
	// The latest target can advance independently for another rule. Compare this
	// rule's path, and require its own successful non-bypassed running apply.
	target, err := s.readTarget(ctx, tx, draft.EngineID)
	if errors.Is(err, sql.ErrNoRows) {
		r.Reason = "runtime_unconfirmed"
		return r, nil, nil
	}
	if err != nil {
		return r, nil, err
	}
	matched := false
	for _, svc := range target.Draft.Services {
		if svc == pub.rule(id) {
			matched = true
			break
		}
	}
	if !matched && !restored || target.Command.RunIntent != "running" {
		r.Reason = "runtime_unconfirmed"
		return r, nil, nil
	}
	// A network timeout in a successful check is a transient observation. An
	// explicit Agent report that the applied files/rule no longer match must
	// suspend distribution until a completed check confirms the current rule.
	var lastProbeCode string
	err = tx.QueryRowContext(ctx, `SELECT coalesce(json_extract(t.result_json,'$.engine.error_code'),'')
		FROM relay_probe_tasks p JOIN tasks t ON t.id=p.task_id
		WHERE p.route_id=? AND p.revision=? AND (t.state='succeeded' OR (t.state='failed' AND json_extract(t.result_json,'$.engine.error_code') IN ('engine_result_unknown','engine_config_unavailable')))
		ORDER BY t.created_at DESC,t.id DESC LIMIT 1`, id, effectiveRevision).Scan(&lastProbeCode)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return r, nil, err
	}
	if lastProbeCode == "engine_result_unknown" || lastProbeCode == "engine_config_unavailable" {
		r.Reason = "probe_unconfirmed"
		return r, nil, nil
	}
	current, node, err := relayLanding(ctx, s, tx, actor, pub.RelayEdit)
	if errors.Is(err, proxy.ErrConflict) {
		r.Reason = "landing_unavailable"
		return r, nil, nil
	}
	if errors.Is(err, proxy.ErrInvalid) || errors.Is(err, proxy.ErrRelayLanding) {
		r.Reason = "landing_changed"
		return r, nil, nil
	}
	if err != nil {
		return r, nil, err
	}
	if current.Fingerprint != pub.Fingerprint {
		r.Reason = "landing_changed"
		return r, nil, nil
	}
	r.PublicProbe, err = readPublicProbe(ctx, tx, id, effectiveRevision, verifyAfter)
	if err != nil {
		return r, nil, err
	}
	if r.PublicProbe == nil || r.PublicProbe.Endpoint != pub.Public || r.PublicProbe.State != "passed" {
		r.Reason = "awaiting_public"
		if r.PublicProbe != nil {
			switch r.PublicProbe.State {
			case "failed":
				r.Reason = "public_failed"
			case "unavailable":
				r.Reason = "probe_unavailable"
			}
		}
		return r, nil, nil
	}
	// A retired/reassigned NAT port must stop appearing in subscriptions even
	// when the immutable route itself has not yet been republished.
	currentTarget, err := publicProbeTarget(ctx, tx, id, r.EntryNode, effectiveRevision, pub.RelayPath)
	if err != nil {
		return r, nil, err
	}
	ip, err := netip.ParseAddr(r.PublicProbe.Address)
	if err != nil || !currentTarget.Allows(ip) {
		r.Reason = "public_mapping_changed"
		return r, nil, nil
	}
	r.VerifiedAt = r.PublicProbe.At
	r.ServingRevision = effectiveRevision
	r.ServingPath = &pub.RelayPath
	if timestamp, err := time.Parse(time.RFC3339Nano, r.VerifiedAt); err == nil {
		r.PublicStale = time.Since(timestamp) > 24*time.Hour
	}
	r.Reason = "available"
	node.Relay = true
	node.ServiceRef = subscription.ServiceRef{NodeID: r.EntryNode, EngineID: pub.EngineID, ServiceID: id}
	node.Host, node.Port, node.Name = pub.Public.Host, pub.Public.Port, r.EntryName+" / "+pub.Name
	return r, &node, nil
}

func (s *Store) RelayRoutes(ctx context.Context, actor, landing, service, entry, after string) ([]proxy.RelayRoute, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `SELECT r.id FROM relay_routes r
		JOIN engines e ON e.id=r.engine_id JOIN engines l ON l.id=r.landing_engine_id
		JOIN users u ON u.id=? AND u.disabled=0
		LEFT JOIN relay_publications p ON p.route_id=r.id AND p.revision=r.target_revision
		WHERE r.deleted=0 AND r.id>? AND (?='' OR r.engine_id=?)
		AND (?='' OR r.landing_engine_id=?) AND (?='' OR r.landing_service_id=?)
		AND (u.role='admin' OR EXISTS(SELECT 1 FROM engine_node_grants entry_grant
			WHERE entry_grant.user_id=u.id AND entry_grant.node_id=e.node_id
			AND ((u.role='operator' AND entry_grant.can_manage=1)
				OR (EXISTS(SELECT 1 FROM engine_node_grants g WHERE g.user_id=u.id AND g.node_id=l.node_id AND g.can_export=1)
				AND (p.route_id IS NULL OR EXISTS(SELECT 1 FROM engines old_landing JOIN engine_node_grants g
					ON g.node_id=old_landing.node_id AND g.user_id=u.id AND g.can_export=1
					WHERE old_landing.id=json_extract(p.path_json,'$.landing_engine_id')))))))
		ORDER BY r.id LIMIT 50`, actor, after, entry, entry, landing, landing, service, service)
	if err != nil {
		return nil, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	items := []proxy.RelayRoute{}
	for _, id := range ids {
		r, _, err := s.relayDetailTx(ctx, tx, actor, id, false)
		if err != nil {
			return nil, err
		}
		items = append(items, r)
	}
	return items, tx.Commit()
}

// A failed preflight changes no active configuration. A start failure is only
// reported after the Agent restored the prior files, process and listeners.
// Require an unchanged ingress mapping and the actual last successful rule.
func (s *Store) rollbackRelayPath(ctx context.Context, tx *sql.Tx, id string, revision int64, next relayPath, code string) (relayPath, bool, error) {
	var old relayPath
	switch code {
	case "engine_target_unreachable", "engine_port_conflict", "engine_start_failed":
	default:
		return old, false, nil
	}
	var raw, snapshot string
	err := tx.QueryRowContext(ctx, `SELECT p.path_json,o.public_snapshot FROM relay_publications p JOIN engine_operations o ON o.engine_id=? JOIN tasks t ON t.id=o.task_id WHERE p.route_id=? AND p.revision=? AND p.operation='publish' AND o.operation='engine.apply' AND t.state='succeeded' AND NOT EXISTS(SELECT 1 FROM engine_operations b WHERE b.engine_id=o.engine_id AND b.active=1) ORDER BY o.revision DESC LIMIT 1`, next.EngineID, id, revision).Scan(&raw, &snapshot)
	if errors.Is(err, sql.ErrNoRows) {
		return old, false, nil
	}
	if err != nil {
		return old, false, err
	}
	if err = json.Unmarshal([]byte(raw), &old); err != nil {
		return old, false, err
	}
	if old.Public != next.Public || old.Listen != next.Listen {
		return old, false, nil
	}
	var applied proxy.Draft
	if err = json.Unmarshal([]byte(snapshot), &applied); err != nil {
		return old, false, err
	}
	for _, rule := range applied.Services {
		if rule == old.rule(id) {
			return old, true, nil
		}
	}
	return old, false, nil
}
