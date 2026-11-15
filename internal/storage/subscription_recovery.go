package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/vioira/viorka/internal/proxy"
	"github.com/vioira/viorka/internal/subscription"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func engineRestoreNeedsReview(ctx context.Context, q engineQuery, engine string) (bool, error) {
	var pending bool
	err := q.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM subscription_restore_engines WHERE engine_id=? AND (state!='matched' OR draft_needs_review=1))`, engine).Scan(&pending)
	return pending, err
}

func (s *Store) SubscriptionRecoveries(ctx context.Context, actor, after string, limit int) ([]subscription.RestoreStatus, string, error) {
	if len(after) > 128 || limit < 1 || limit > 20 {
		return nil, "", subscription.ErrInvalid
	}
	admin, err := subscriptionActor(ctx, s.db, actor, false)
	if err != nil {
		return nil, "", err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT r.engine_id FROM subscription_restore_engines r JOIN engines e ON e.id=r.engine_id WHERE r.engine_id>? AND (? OR EXISTS(SELECT 1 FROM engine_node_grants g WHERE g.node_id=e.node_id AND g.user_id=? AND g.can_manage=1)) ORDER BY r.engine_id LIMIT ?`, after, admin, actor, limit)
	if err != nil {
		return nil, "", err
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			break
		}
		ids = append(ids, id)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return nil, "", err
	}
	items := make([]subscription.RestoreStatus, 0, len(ids))
	for _, id := range ids {
		v, err := s.SubscriptionRecovery(ctx, actor, id)
		if err != nil {
			return nil, "", err
		}
		items = append(items, v)
	}
	next := ""
	if len(ids) == limit {
		next = ids[len(ids)-1]
	}
	return items, next, nil
}

func truncateRecoveryName(name, suffix string) string {
	name = strings.TrimSpace(name)
	for len(name)+len(suffix) > 128 && len(name) > 0 {
		_, n := utf8.DecodeLastRuneInString(name)
		name = name[:len(name)-n]
	}
	if name == "" {
		name = "出口"
	}
	return name + suffix
}

// adoptRecoveryTx only changes Panel records. The observation was received
// from the authenticated node in response to a matching recovery task, and no
// command is sent to the node while adopting it.
func (s *Store) adoptRecoveryTx(ctx context.Context, tx *sql.Tx, actor, node, id string, observed *v1.EngineRecovery, needsReview bool) error {
	if v1.ValidateRecoveryObservation(id, observed) != nil {
		return subscription.ErrInvalid
	}
	e, err := scanEngine(tx.QueryRowContext(ctx, `SELECT `+engineColumns+` FROM engines e LEFT JOIN engine_drafts d ON d.engine_id=e.id WHERE e.id=? AND e.node_id=?`, id, node))
	if err != nil {
		return err
	}
	if e.Ownership != "managed" || e.Name != observed.Command.Name {
		return subscription.ErrConflict
	}
	oldTarget, err := s.readTarget(ctx, tx, id)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	command := *observed.Command
	draft := proxy.Draft{Version: e.Draft.Version, UpdatedBy: actor, UpdatedAt: now(), Services: []proxy.Service{}}
	credentials := map[string]engineCredential{}
	for _, service := range command.Services {
		v := proxy.Service{ID: service.ID, Name: service.Name, Enabled: service.Enabled, ListenHost: service.ListenHost, ListenPort: int(service.ListenPort), TargetHost: service.TargetHost, TargetPort: int(service.TargetPort), ServerName: service.ServerName}
		for _, old := range oldTarget.Draft.Services {
			if old.ID == service.ID {
				v.PublicHost, v.PublicPort = old.PublicHost, old.PublicPort
				break
			}
		}
		draft.Services = append(draft.Services, v)
		credentials[service.ID] = engineCredential{UUID: service.Uuid, PrivateKey: service.PrivateKey, ShortIDs: append([]string{}, service.ShortIds...)}
	}
	if command.Routing != nil && oldTarget.Draft.Routing != nil && sameAppliedServices(oldTarget.Command, command) {
		draft.Routing = oldTarget.Draft.Routing
	} else if command.Routing != nil {
		raw, err := json.Marshal(command.Routing)
		if err != nil {
			return err
		}
		if err = json.Unmarshal(raw, &draft.Routing); err != nil {
			return err
		}
		mapping := map[string]string{}
		for _, outbound := range command.Outbounds {
			if outbound == nil {
				return subscription.ErrInvalid
			}
			raw, err = json.Marshal(outbound)
			if err != nil {
				return err
			}
			var config proxy.OutboundConfig
			if err = json.Unmarshal(raw, &config); err != nil {
				return err
			}
			oldID := config.ID
			newID, err := subscriptionRandom()
			if err != nil {
				return err
			}
			config.ID = newID
			config.Name = truncateRecoveryName(config.Name, " (恢复 "+newID[:8]+")")
			if config.Validate() != nil {
				return subscription.ErrInvalid
			}
			raw, err = json.Marshal(config)
			if err != nil {
				return err
			}
			sealed, err := s.sealEngine("outbound:"+config.ID, raw)
			if err != nil {
				return err
			}
			if _, err = tx.ExecContext(ctx, `INSERT INTO outbound_configs(id,name,version,config_encrypted,created_at) VALUES(?,?,1,?,?)`, config.ID, config.Name, sealed, now()); err != nil {
				return err
			}
			mapping[oldID] = config.ID
		}
		for i, old := range draft.Routing.OutboundIds {
			mapped, ok := mapping[old]
			if !ok {
				return subscription.ErrInvalid
			}
			draft.Routing.OutboundIds[i] = mapped
		}
		if mapped, ok := mapping[draft.Routing.Final]; ok {
			draft.Routing.Final = mapped
		}
		for _, rule := range draft.Routing.Rules {
			if mapped, ok := mapping[rule.Outbound]; ok {
				rule.Outbound = mapped
			}
		}
	}
	target := engineTarget{ID: id, Node: node, Actor: actor, Revision: int64(command.Revision), Command: command, Draft: draft, Credentials: credentials}
	// The old reservations came from the restored snapshot. Replace them with
	// the observed listeners and retain non-conflicting draft reservations.
	if _, err = tx.ExecContext(ctx, `DELETE FROM engine_port_reservations WHERE engine_id=?`, id); err != nil {
		return err
	}
	if err = checkTargetPorts(ctx, tx, target); err != nil {
		return err
	}
	if err = reserveTarget(ctx, tx, target); err != nil {
		return err
	}
	for _, service := range e.Draft.Services {
		if _, err = tx.ExecContext(ctx, `INSERT OR IGNORE INTO engine_port_reservations(node_id,engine_id,service_id,listen_host,listen_port) VALUES(?,?,?,?,?)`, node, id, service.ID, service.ListenHost, service.ListenPort); err != nil {
			return err
		}
	}
	rawCredentials, err := json.Marshal(credentials)
	if err != nil {
		return err
	}
	sealed, err := s.sealEngine(id, rawCredentials)
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO engine_credentials(engine_id,encrypted) VALUES(?,?) ON CONFLICT(engine_id) DO UPDATE SET encrypted=excluded.encrypted`, id, sealed); err != nil {
		return err
	}
	if err = s.writeTarget(ctx, tx, target, false); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE engines SET version=?,status=?,run_intent=?,observed_revision=?,desired_revision=max(desired_revision,?),observed_at=? WHERE id=? AND node_id=?`, command.Version, observed.Status, command.RunIntent, command.Revision, command.Revision, now(), id, node); err != nil {
		return err
	}
	// Invalidate a draft that was loaded before adoption without replacing it.
	if needsReview {
		if _, err = tx.ExecContext(ctx, `UPDATE engine_drafts SET version=version+1 WHERE engine_id=?`, id); err != nil {
			return err
		}
	}
	services, err := json.Marshal(command.Services)
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE subscription_service_links SET invalidated=1 WHERE node_id=? AND engine_id=? AND NOT EXISTS(SELECT 1 FROM json_each(?) v WHERE json_extract(v.value,'$.id')=subscription_service_links.service_id)`, node, id, string(services)); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM subscription_restore_endpoints WHERE engine_id=?`, id); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE subscription_restore_engines SET state='matched',observed_revision=?,draft_needs_review=? WHERE engine_id=?`, command.Revision, needsReview, id); err != nil {
		return err
	}
	return audit(ctx, tx, actor, "subscription.recovery.adopt", "engine", id)
}

// Recovery access always requires the existing node management permission;
// adopting credentials additionally requires the existing export permission.
func recoveryAccessTx(ctx context.Context, tx *sql.Tx, actor, engine string, export bool) (string, error) {
	var node string
	err := tx.QueryRowContext(ctx, `SELECT node_id FROM engines WHERE id=?`, engine).Scan(&node)
	if errors.Is(err, sql.ErrNoRows) {
		return "", subscription.ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if err = engineAccess(ctx, tx, actor, node, true); err != nil {
		if errors.Is(err, proxy.ErrForbidden) {
			return "", subscription.ErrForbidden
		}
		return "", err
	}
	if export {
		var allowed bool
		if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id=? AND role='admin' AND disabled=0) OR EXISTS(SELECT 1 FROM engine_node_grants WHERE user_id=? AND node_id=? AND can_export=1)`, actor, actor, node).Scan(&allowed); err != nil {
			return "", err
		}
		if !allowed {
			return "", subscription.ErrForbidden
		}
	}
	return node, nil
}

func (s *Store) SubscriptionRecovery(ctx context.Context, actor, engine string) (subscription.RestoreStatus, error) {
	var view subscription.RestoreStatus
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return view, err
	}
	defer tx.Rollback()
	node, err := recoveryAccessTx(ctx, tx, actor, engine, false)
	if err != nil {
		return view, err
	}
	view.EngineID, view.NodeID = engine, node
	var currentObservedRevision int64
	if err = tx.QueryRowContext(ctx, `SELECT e.name,e.status,n.name,n.state,e.observed_revision FROM engines e JOIN nodes n ON n.id=e.node_id WHERE e.id=?`, engine).Scan(&view.EngineName, &view.RuntimeStatus, &view.NodeName, &view.NodeState, &currentObservedRevision); err != nil {
		return view, err
	}
	var sealed string
	err = tx.QueryRowContext(ctx, `SELECT state,task_id,observed_revision,draft_needs_review,observed_encrypted FROM subscription_restore_engines WHERE engine_id=?`, engine).Scan(&view.State, &view.TaskID, &view.ObservedRevision, &view.DraftNeedsReview, &sealed)
	if errors.Is(err, sql.ErrNoRows) {
		return view, subscription.ErrNotFound
	}
	if err != nil {
		return view, err
	}
	if view.TaskID != "" {
		err = tx.QueryRowContext(ctx, `SELECT state,coalesce(json_extract(result_json,'$.error_code'),'') FROM tasks WHERE id=? AND node_id=?`, view.TaskID, node).Scan(&view.TaskState, &view.ErrorCode)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return view, err
		}
	}
	view.Services = []subscription.RestoreService{}
	if sealed != "" {
		raw, err := s.openEngine(engine, sealed)
		if err != nil {
			return view, err
		}
		var observed v1.EngineRecovery
		if err = json.Unmarshal(raw, &observed); err != nil || v1.ValidateRecoveryObservation(engine, &observed) != nil {
			return view, subscription.ErrInvalid
		}
		target, err := s.readTarget(ctx, tx, engine)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return view, err
		}
		// Once recovery has matched, later successful publications become the
		// source of endpoint confirmations. Otherwise new services would remain
		// permanently hidden by the older recovery observation.
		if view.State == "matched" && target.Error == "" && target.Revision <= currentObservedRevision {
			for _, service := range target.Draft.Services {
				if service.PendingDelete {
					continue
				}
				entry := subscription.RestoreService{ID: service.ID, Name: service.Name, Enabled: service.Enabled, PublicHost: service.PublicHost, PublicPort: service.PublicPort, Change: "unchanged"}
				if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM subscription_restore_endpoints WHERE engine_id=? AND service_id=? AND public_host=? AND public_port=?)`, engine, entry.ID, entry.PublicHost, entry.PublicPort).Scan(&entry.Confirmed); err != nil {
					return view, err
				}
				view.Services = append(view.Services, entry)
			}
			return view, tx.Commit()
		}
		seen := map[string]bool{}
		for _, service := range observed.Command.Services {
			entry := subscription.RestoreService{ID: service.ID, Name: service.Name, Enabled: service.Enabled}
			entry.Change = "added"
			seen[service.ID] = true
			for _, old := range target.Draft.Services {
				if old.ID == service.ID {
					entry.PublicHost, entry.PublicPort = old.PublicHost, old.PublicPort
					entry.Change = "unchanged"
					if old.Name != service.Name || old.Enabled != service.Enabled || old.ListenHost != service.ListenHost || old.ListenPort != int(service.ListenPort) || old.TargetHost != service.TargetHost || old.TargetPort != int(service.TargetPort) || old.ServerName != service.ServerName {
						entry.Change = "changed"
					}
					credential := target.Credentials[service.ID]
					entry.CredentialsChanged = credential.UUID != service.Uuid || credential.PrivateKey != service.PrivateKey || strings.Join(credential.ShortIDs, ",") != strings.Join(service.ShortIds, ",")
					if entry.CredentialsChanged {
						entry.Change = "changed"
					}
				}
			}
			if entry.PublicHost != "" {
				if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM subscription_restore_endpoints WHERE engine_id=? AND service_id=? AND public_host=? AND public_port=?)`, engine, entry.ID, entry.PublicHost, entry.PublicPort).Scan(&entry.Confirmed); err != nil {
					return view, err
				}
			}
			view.Services = append(view.Services, entry)
		}
		for _, old := range target.Draft.Services {
			if !seen[old.ID] {
				view.Services = append(view.Services, subscription.RestoreService{ID: old.ID, Name: old.Name, PublicHost: old.PublicHost, PublicPort: old.PublicPort, Change: "removed", Enabled: old.Enabled})
			}
		}
	}
	return view, tx.Commit()
}

func (s *Store) AdoptSubscriptionRecovery(ctx context.Context, actor, engine, task string, confirm bool) error {
	if !confirm || len(task) < 1 || len(task) > 128 {
		return subscription.ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	node, err := recoveryAccessTx(ctx, tx, actor, engine, true)
	if err != nil {
		return err
	}
	var state, storedTask, sealed string
	err = tx.QueryRowContext(ctx, `SELECT state,task_id,observed_encrypted FROM subscription_restore_engines WHERE engine_id=?`, engine).Scan(&state, &storedTask, &sealed)
	if errors.Is(err, sql.ErrNoRows) {
		return subscription.ErrNotFound
	}
	if err != nil {
		return err
	}
	if state != "mismatch" || task != storedTask || sealed == "" {
		return subscription.ErrConflict
	}
	var completedAt, nodeState string
	if err = tx.QueryRowContext(ctx, `SELECT t.updated_at,n.state FROM tasks t JOIN nodes n ON n.id=t.node_id WHERE t.id=? AND t.node_id=? AND t.state='succeeded'`, task, node).Scan(&completedAt, &nodeState); errors.Is(err, sql.ErrNoRows) {
		return subscription.ErrConflict
	} else if err != nil {
		return err
	}
	completed, err := time.Parse(time.RFC3339Nano, completedAt)
	if err != nil {
		return err
	}
	if nodeState != "online" || time.Since(completed) > 5*time.Minute || completed.After(time.Now().Add(time.Minute)) {
		return subscription.ErrConflict
	}
	var active bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM engine_operations WHERE engine_id=? AND active=1)`, engine).Scan(&active); err != nil {
		return err
	}
	if active {
		return subscription.ErrConflict
	}
	raw, err := s.openEngine(engine, sealed)
	if err != nil {
		return err
	}
	var observed v1.EngineRecovery
	if err = json.Unmarshal(raw, &observed); err != nil {
		return err
	}
	if err = s.adoptRecoveryTx(ctx, tx, actor, node, engine, &observed, true); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) ConfirmSubscriptionEndpoint(ctx context.Context, actor, engine, service, expectedHost string, expectedPort int, host string, port int, confirm bool) error {
	if !confirm || service == "" || len(service) > 64 || len(expectedHost) > 253 || expectedPort < 0 || expectedPort > 65535 || !proxy.ValidHost(host) || port < 1 || port > 65535 {
		return subscription.ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = recoveryAccessTx(ctx, tx, actor, engine, false); err != nil {
		return err
	}
	var state string
	if err = tx.QueryRowContext(ctx, `SELECT state FROM subscription_restore_engines WHERE engine_id=?`, engine).Scan(&state); errors.Is(err, sql.ErrNoRows) {
		return subscription.ErrNotFound
	} else if err != nil {
		return err
	}
	if state != "matched" {
		return subscription.ErrConflict
	}
	target, err := s.readTarget(ctx, tx, engine)
	if err != nil {
		return err
	}
	var observedRevision int64
	var active bool
	if err = tx.QueryRowContext(ctx, `SELECT observed_revision,EXISTS(SELECT 1 FROM engine_operations o WHERE o.engine_id=engines.id AND o.active=1) FROM engines WHERE id=?`, engine).Scan(&observedRevision, &active); err != nil {
		return err
	}
	if active || target.Revision > observedRevision {
		return subscription.ErrConflict
	}
	found := false
	changed := false
	for i, v := range target.Draft.Services {
		if v.ID == service && v.Enabled && v.PublicHost == expectedHost && v.PublicPort == expectedPort {
			found = true
			changed = v.PublicHost != host || v.PublicPort != port
			target.Draft.Services[i].PublicHost = host
			target.Draft.Services[i].PublicPort = port
		}
	}
	if !found {
		return subscription.ErrConflict
	}
	if changed {
		raw, err := json.Marshal(target.Draft)
		if err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE engine_targets SET public_snapshot=?,updated_by=? WHERE engine_id=? AND revision=?`, string(raw), actor, engine, target.Revision); err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE subscription_restore_engines SET draft_needs_review=1 WHERE engine_id=?`, engine); err != nil {
			return err
		}
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO subscription_restore_endpoints(engine_id,service_id,public_host,public_port,confirmed_at) VALUES(?,?,?,?,?) ON CONFLICT(engine_id,service_id) DO UPDATE SET public_host=excluded.public_host,public_port=excluded.public_port,confirmed_at=excluded.confirmed_at`, engine, service, host, port, now()); err != nil {
		return err
	}
	if err = audit(ctx, tx, actor, "subscription.endpoint.confirm", "engine", engine); err != nil {
		return err
	}
	return tx.Commit()
}
