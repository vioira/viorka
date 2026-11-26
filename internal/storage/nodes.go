package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/inventory"
	"github.com/vioira/viorka/internal/monitoring"
	"github.com/vioira/viorka/internal/realtime"
	v1 "github.com/vioira/viorka/protocol/v1"
	"slices"
	"strings"
	"time"
)

const nodeSelect = `SELECT id,name,kind,state,coalesce(last_seen_at,''),coalesce(os,''),
  coalesce(arch,''),coalesce(agent_version,''),coalesce(inventory_json,''),
  geo_country_code,geo_subdivision,geo_city,origin_migration,uptime_seconds,uptime_sampled_at,
  billing_revision,price_minor,coalesce(currency,''),period_months,rental_expires_at,observed_cpu_cores FROM nodes`

func scanNode(row interface{ Scan(...any) error }) (inventory.Node, error) {
	var n inventory.Node
	var raw string
	var minor *int64
	err := row.Scan(&n.ID, &n.Name, &n.Kind, &n.State, &n.LastSeenAt, &n.OS, &n.Arch, &n.AgentVersion, &raw,
		&n.Location.CountryCode, &n.Location.Subdivision, &n.Location.City, &n.OriginMigration,
		&n.UptimeSeconds, &n.UptimeSampledAt, &n.Billing.Revision, &minor, &n.Billing.Currency, &n.Billing.PeriodMonths, &n.Billing.ExpiresAt, &n.CPUCores)
	if err == nil {
		n.Billing.SetMinorUnits(minor)
		if raw != "" {
			err = json.Unmarshal([]byte(raw), &n.Inventory)
		}
	}
	return n, err
}

func (s *Store) Nodes(ctx context.Context, limit int, after string) ([]inventory.Node, error) {
	rows, err := s.db.QueryContext(ctx, nodeSelect+` WHERE id>? ORDER BY id LIMIT ?`, after, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []inventory.Node{}
	for rows.Next() {
		n, err := scanNode(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, n)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	return items, s.loadNodeCategories(ctx, items)
}
func (s *Store) Online(ctx context.Context, node string, h v1.Hello) error {
	supportsOrigin := slices.Contains(h.Capabilities, v1.OriginMigrationCapability)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	r, err := tx.ExecContext(ctx, `UPDATE nodes SET state='online',outage_since=NULL,offline_alert_since=NULL,last_seen_at=?,os=?,arch=?,agent_version=?,engine_capable=?,engine_recovery_capable=?,origin_capable=?,
 origin_migration=CASE WHEN origin_migration='' THEN '' WHEN ?=0 THEN 'upgrade_required'
 WHEN origin_migration='upgrade_required' THEN 'pending' ELSE origin_migration END WHERE id=? AND state!='disabled'`, now(), h.OS, h.Arch, h.AgentVersion, slices.Contains(h.Capabilities, v1.EngineCapability), slices.Contains(h.Capabilities, v1.EngineRecoveryCapability), supportsOrigin, supportsOrigin, node)
	if err != nil {
		return err
	}
	n, _ := r.RowsAffected()
	if n != 1 {
		return auth.ErrUnauthorized
	}
	changed, err := recoverOfflineRules(ctx, tx, node, time.Now())
	if err != nil {
		return err
	}
	changes := []realtime.Change{{Kind: "node", NodeID: node}}
	// A new hello can make a pending check unsupported, in which case no
	// dispatch will follow to invalidate the engine view.
	var pendingCheck bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM engines e JOIN subscription_restore_engines r ON r.engine_id=e.id WHERE e.node_id=? AND r.reason!='restore' AND r.state='pending')`, node).Scan(&pendingCheck); err != nil {
		return err
	}
	if pendingCheck {
		changes = append(changes, realtime.Change{Kind: "engines", NodeID: node})
	}
	return s.commitAlertEvents(tx, changed, changes...)
}
func (s *Store) Heartbeat(ctx context.Context, node string) error {
	r, err := s.db.ExecContext(ctx, `UPDATE nodes SET last_seen_at=? WHERE id=? AND state='online'`, now(), node)
	if err != nil {
		return err
	}
	n, _ := r.RowsAffected()
	if n != 1 {
		return auth.ErrUnauthorized
	}
	// Heartbeats persist liveness only. Actual state changes publish node events.
	return nil
}

// AgentStopped records an intentional shutdown without raising a network outage alert.
func (s *Store) AgentStopped(ctx context.Context, node string) error {
	result, err := s.db.ExecContext(ctx, `UPDATE nodes SET state='offline',outage_since=NULL,offline_alert_since=NULL WHERE id=?
        AND (state='online' OR (state='offline' AND (offline_alert_since IS NOT NULL OR outage_since IS NOT NULL)))`, node)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err == nil && count != 0 {
		s.events.Publish(realtime.Change{Kind: "node", NodeID: node})
	}
	return err
}

func (s *Store) Offline(ctx context.Context, node string) error {
	result, err := s.db.ExecContext(ctx, `UPDATE nodes SET state='offline',outage_since=?,offline_alert_since=CASE WHEN (SELECT offline_alert_minutes FROM system_settings WHERE id=1)>0 THEN ? END WHERE id=? AND state='online'`, now(), now(), node)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err == nil && n > 0 {
		s.events.Publish(realtime.Change{Kind: "node", NodeID: node})
	}
	return err
}
func (s *Store) Recover(ctx context.Context) error {
	return s.ExpireOffline(ctx, time.Now())
}

func (s *Store) Node(ctx context.Context, id string) (inventory.Node, error) {
	n, err := scanNode(s.db.QueryRowContext(ctx, nodeSelect+` WHERE id=?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return n, auth.ErrNotFound
	}
	if err != nil {
		return n, err
	}
	nodes := []inventory.Node{n}
	err = s.loadNodeCategories(ctx, nodes)
	return nodes[0], err
}

// DeleteNode removes Panel records only. Acquire the write lock before checking
// dependencies so task creation and deletion cannot race past each other.
// Cascades remove credentials, challenges, sessions, tasks and metric history;
// audit records deliberately outlive the node.
func (s *Store) DeleteNode(ctx context.Context, actor, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `UPDATE nodes SET state=state WHERE id=?`, id)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return auth.ErrNotFound
	}
	var busy, referenced bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM tasks WHERE node_id=? AND state IN ('queued','dispatched','accepted','running'))`, id).Scan(&busy); err != nil {
		return err
	}
	if busy {
		return inventory.ErrNodeBusy
	}
	if err = tx.QueryRowContext(ctx, `SELECT
		EXISTS(SELECT 1 FROM engines WHERE node_id=? AND ownership!='managed') OR
		EXISTS(SELECT 1 FROM proxy_services WHERE node_id=?) OR
		EXISTS(SELECT 1 FROM relay_rules WHERE source_node_id=? OR destination_node_id=?) OR
		EXISTS(SELECT 1 FROM config_revisions WHERE node_id=? AND resource_kind!='engine') OR
		EXISTS(SELECT 1 FROM deployments WHERE node_id=?)`, id, id, id, id, id, id).Scan(&referenced); err != nil {
		return err
	}
	if referenced {
		return inventory.ErrNodeReferenced
	}
	if err = s.archiveEngineMetadata(ctx, tx, id); err != nil {
		return err
	}
	// Remove operation references before the node cascades its managed engines.
	if _, err = tx.ExecContext(ctx, `DELETE FROM engine_operations WHERE engine_id IN (SELECT id FROM engines WHERE node_id=?)`, id); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE subscription_service_links SET invalidated=1 WHERE node_id=?`, id); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE status_publication SET revision=revision+1 WHERE id=1 AND EXISTS(SELECT 1 FROM status_nodes WHERE node_id=?)`, id); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM nodes WHERE id=?`, id); err != nil {
		return err
	}
	if err = audit(ctx, tx, actor, "node.delete", "node", id); err != nil {
		return err
	}
	return s.commitChanges(tx, realtime.Change{Kind: "nodes", NodeID: id}, realtime.Change{Kind: "notifications"}, realtime.Change{Kind: "tasks"})
}

// SaveInventory persists the latest observation, including unavailable fields.
func (s *Store) SaveInventory(ctx context.Context, node string, v v1.NodeInventory) error {
	if err := v.Validate(time.Now()); err != nil {
		return err
	}
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `UPDATE nodes SET inventory_json=json_set(?,'$.sampled_at',?) WHERE id=? AND state='online' AND (inventory_json IS NULL OR json_extract(inventory_json,'$.sampled_at')<?)`, string(b), at(v.SampledAt), node, at(v.SampledAt))
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n != 1 {
		return auth.ErrConflict
	}
	addresses := []monitoring.AddressSnapshot{
		{Family: 4, Address: v.PublicIpv4, SampledAt: v.SampledAt.UnixMilli(), Unavailable: v.PublicIpv4 == ""},
		{Family: 6, Address: v.PublicIpv6, SampledAt: v.SampledAt.UnixMilli(), Unavailable: v.PublicIpv6 == ""},
	}
	if _, err = savePublicAddresses(ctx, tx, node, addresses); err != nil {
		return err
	}
	return s.commitChanges(tx, realtime.Change{Kind: "node", NodeID: node})
}

// EngineSummaries reads only public labels, with the same node grants as Engines.
func (s *Store) EngineSummaries(ctx context.Context, actor string, ids []string) (map[string][]inventory.EngineSummary, error) {
	result := map[string][]inventory.EngineSummary{}
	if len(ids) == 0 {
		return result, nil
	}
	args := []any{actor}
	for _, id := range ids {
		args = append(args, id)
	}
	rows, err := s.db.QueryContext(ctx, `SELECT n.id,e.name,e.version,EXISTS(SELECT 1 FROM subscription_restore_engines r WHERE r.engine_id=e.id AND r.reason!='restore' AND r.state='pending') FROM nodes n
 JOIN users u ON u.id=? AND u.disabled=0
 LEFT JOIN engines e ON e.node_id=n.id AND e.status!='not_installed'
 WHERE n.id IN (`+strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")+`)
 AND (u.role='admin' OR EXISTS(SELECT 1 FROM engine_node_grants g WHERE g.user_id=u.id AND g.node_id=n.id))
 ORDER BY n.id,e.name`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var name, version sql.NullString
		var pending bool
		if err := rows.Scan(&id, &name, &version, &pending); err != nil {
			return nil, err
		}
		if result[id] == nil {
			result[id] = []inventory.EngineSummary{}
		}
		if name.Valid {
			result[id] = append(result[id], inventory.EngineSummary{Name: name.String, Version: version.String, VerificationPending: pending})
		}
	}
	return result, rows.Err()
}

func (s *Store) OriginRefreshNeeded(ctx context.Context, node, sessionHash string) (bool, error) {
	var needed bool
	err := s.db.QueryRowContext(ctx, `SELECT EXISTS(
 SELECT 1 FROM agent_sessions a JOIN system_settings s ON s.id=1
 WHERE a.node_id=? AND a.token_hash=? AND a.signed_origin<>s.public_origin)`, node, sessionHash).Scan(&needed)
	return needed, err
}
func (s *Store) ConfirmOrigin(ctx context.Context, node, sessionHash, origin string) error {
	result, err := s.db.ExecContext(ctx, `UPDATE nodes SET origin_migration='confirmed' WHERE id=? AND state='online' AND origin_migration='pending' AND EXISTS(
 SELECT 1 FROM agent_sessions a JOIN system_settings s ON s.public_origin=a.signed_origin AND s.id=1
 JOIN agent_credentials c ON c.node_id=a.node_id WHERE a.node_id=nodes.id AND a.token_hash=?
 AND a.expires_at>? AND c.status='active' AND a.signed_origin=?)`, node, sessionHash, now(), origin)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err == nil && count > 0 {
		s.events.Publish(realtime.Change{Kind: "node", NodeID: node})
	}
	return err
}

func (s *Store) KnownCPUCores(ctx context.Context, node string) (uint64, error) {
	var n uint64
	err := s.db.QueryRowContext(ctx, "SELECT COALESCE(observed_cpu_cores,0) FROM nodes WHERE id=?", node).Scan(&n)
	return n, err
}

func (s *Store) SaveCPUCores(ctx context.Context, node string, cores uint64) error {
	if cores < 1 || cores > 65536 {
		return errors.New("invalid observed CPU count")
	}
	result, err := s.db.ExecContext(ctx, "UPDATE nodes SET observed_cpu_cores=? WHERE id=? AND COALESCE(observed_cpu_cores,0)<>?", cores, node, cores)
	if err != nil {
		return err
	}
	changed, err := result.RowsAffected()
	if err == nil && changed > 0 {
		s.Events().Publish(realtime.Change{Kind: "node", NodeID: node})
	}
	return err
}
