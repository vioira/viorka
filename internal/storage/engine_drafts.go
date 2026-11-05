package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/proxy"
	"github.com/vioira/viorka/internal/realtime"
)

type engineQuery interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

// Engine permissions are resource-scoped. An installation administrator remains
// the explicit owner; operator/viewer roles alone never grant node access.
func engineAccess(ctx context.Context, q engineQuery, actor, node string, manage bool) error {
	var role string
	var disabled bool
	if err := q.QueryRowContext(ctx, `SELECT role,disabled FROM users WHERE id=?`, actor).Scan(&role, &disabled); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return proxy.ErrForbidden
		}
		return err
	}
	if disabled {
		return proxy.ErrForbidden
	}
	if role == "admin" {
		return nil
	}
	if manage && role != "operator" {
		return proxy.ErrForbidden
	}
	var granted bool
	if err := q.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM engine_node_grants WHERE user_id=? AND node_id=? AND (?=0 OR can_manage=1))`, actor, node, manage).Scan(&granted); err != nil {
		return err
	}
	if !granted {
		return proxy.ErrForbidden
	}
	return nil
}

const engineColumns = `(CASE WHEN EXISTS(SELECT 1 FROM engine_targets et WHERE et.engine_id=e.id AND et.sync_error!='') THEN 'failed' WHEN EXISTS(SELECT 1 FROM engine_operations eo WHERE eo.engine_id=e.id AND eo.active=1) THEN 'syncing' WHEN EXISTS(SELECT 1 FROM engine_targets et WHERE et.engine_id=e.id AND et.revision>e.observed_revision) THEN 'pending' WHEN EXISTS(SELECT 1 FROM engine_targets et WHERE et.engine_id=e.id) THEN 'synced' ELSE 'unpublished' END),coalesce((SELECT sync_error FROM engine_targets et WHERE et.engine_id=e.id),''),e.observed_at,e.id,e.node_id,e.name,coalesce(e.version,''),e.ownership,e.status,e.run_intent,e.desired_revision,e.observed_revision,coalesce(d.version,0),coalesce(d.services_json,'[]'),coalesce(d.updated_by,''),coalesce(d.updated_at,'')`

func scanEngine(row interface{ Scan(...any) error }) (proxy.Engine, error) {
	var e proxy.Engine
	var raw string
	err := row.Scan(&e.SyncState, &e.SyncError, &e.ObservedAt, &e.ID, &e.NodeID, &e.Name, &e.Version, &e.Ownership, &e.Status, &e.RunIntent, &e.DesiredRevision, &e.ObservedRevision, &e.Draft.Version, &raw, &e.Draft.UpdatedBy, &e.Draft.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return e, auth.ErrNotFound
	}
	if err != nil {
		return e, err
	}
	err = json.Unmarshal([]byte(raw), &e.Draft.Services)
	e.ExternalConnectivity = "unverified"
	return e, err
}
func (s *Store) Engines(ctx context.Context, actor, node string) ([]proxy.Engine, error) {
	if err := engineAccess(ctx, s.db, actor, node, false); err != nil {
		return nil, err
	}
	var exists bool
	if err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM nodes WHERE id=?)`, node).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, auth.ErrNotFound
	}
	rows, err := s.db.QueryContext(ctx, `SELECT `+engineColumns+` FROM engines e LEFT JOIN engine_drafts d ON d.engine_id=e.id WHERE e.node_id=? ORDER BY e.name LIMIT 3`, node)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []proxy.Engine{}
	for rows.Next() {
		e, err := scanEngine(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, e)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	for i := range items {
		if err = resolveDraftReferences(ctx, s.db, &items[i].Draft); err != nil {
			return nil, err
		}
	}
	return items, nil
}
func (s *Store) Engine(ctx context.Context, actor, id string) (proxy.Engine, error) {
	e, err := scanEngine(s.db.QueryRowContext(ctx, `SELECT `+engineColumns+` FROM engines e LEFT JOIN engine_drafts d ON d.engine_id=e.id WHERE e.id=?`, id))
	if err != nil {
		return e, err
	}
	if err = engineAccess(ctx, s.db, actor, e.NodeID, false); err != nil {
		return proxy.Engine{}, err
	}
	if err = resolveDraftReferences(ctx, s.db, &e.Draft); err != nil {
		return proxy.Engine{}, err
	}
	return e, nil
}
func (s *Store) SaveEngineDraft(ctx context.Context, actor, id string, d proxy.Draft) (proxy.Draft, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return proxy.Draft{}, err
	}
	defer tx.Rollback()
	// Acquire the SQLite writer before reading reservations or the CAS version.
	if _, err = tx.ExecContext(ctx, `UPDATE engines SET id=id WHERE id=?`, id); err != nil {
		return proxy.Draft{}, err
	}
	e, err := scanEngine(tx.QueryRowContext(ctx, `SELECT `+engineColumns+` FROM engines e LEFT JOIN engine_drafts d ON d.engine_id=e.id WHERE e.id=?`, id))
	if err != nil {
		return proxy.Draft{}, err
	}
	if err = engineAccess(ctx, tx, actor, e.NodeID, true); err != nil {
		return proxy.Draft{}, err
	}
	if e.Ownership != "managed" || e.Status == "not_installed" || e.Version == "" || d.Version != e.Draft.Version {
		return proxy.Draft{}, proxy.ErrConflict
	}
	for i, service := range d.Services {
		if service.PresetID == "" {
			continue
		}
		p, err := scanPreset(tx.QueryRowContext(ctx, `SELECT id,config_json,created_at FROM protocol_presets WHERE id=?`, service.PresetID))
		if err != nil {
			return proxy.Draft{}, err
		}
		if proxy.PresetReferenceIssue(e.Name, p.Config) != "" {
			return proxy.Draft{}, proxy.ErrPresetUnsupported
		}
		d.Services[i] = proxy.ResolvePreset(service, p.Config)
	}
	if err = proxy.ValidateDraft(e.Name, d); err != nil {
		return proxy.Draft{}, err
	}
	// Preserve listeners that are still applied or captured by an in-flight snapshot.
	reserved := append([]proxy.Service{}, d.Services...)
	snapshots, err := tx.QueryContext(ctx, `SELECT public_snapshot FROM engine_operations o JOIN tasks t ON t.id=o.task_id WHERE o.engine_id=? AND o.operation='engine.apply' AND (o.active=1 OR o.revision>(SELECT observed_revision FROM engines WHERE id=o.engine_id) OR o.revision=(SELECT max(p.revision) FROM engine_operations p JOIN tasks pt ON pt.id=p.task_id WHERE p.engine_id=? AND p.operation='engine.apply' AND pt.state='succeeded')) UNION ALL SELECT public_snapshot FROM engine_targets WHERE engine_id=?`, id, id, id)
	if err != nil {
		return proxy.Draft{}, err
	}
	protected := []proxy.Service{}
	for snapshots.Next() {
		var raw string
		if err = snapshots.Scan(&raw); err != nil {
			break
		}
		var prior proxy.Draft
		if err = json.Unmarshal([]byte(raw), &prior); err != nil {
			break
		}
		for _, service := range prior.Services {
			if !service.PendingDelete {
				protected = append(protected, service)
			}
		}
	}
	if err == nil {
		err = snapshots.Err()
	}
	snapshots.Close()
	if err != nil {
		return proxy.Draft{}, err
	}
	for _, old := range protected {
		present := false
		for _, next := range d.Services {
			if next.ID == old.ID {
				present = true
			} else if proxy.PortsConflict(next.ListenHost, next.ListenPort, old.ListenHost, old.ListenPort) {
				return proxy.Draft{}, proxy.ErrConflict
			}
		}
		if !present {
			return proxy.Draft{}, proxy.ErrConflict
		}
		reserved = append(reserved, old)
	}
	// Check the shared reservation space, including legacy proxy/relay listeners.
	rows, err := tx.QueryContext(ctx, `SELECT listen_host,listen_port FROM engine_port_reservations WHERE node_id=? AND engine_id!=? UNION ALL SELECT listen_host,listen_port FROM proxy_services WHERE node_id=? UNION ALL SELECT listen_host,listen_port FROM relay_rules WHERE source_node_id=?`, e.NodeID, id, e.NodeID, e.NodeID)
	if err != nil {
		return proxy.Draft{}, err
	}
	conflict := false
	for rows.Next() {
		var host string
		var port int
		if err = rows.Scan(&host, &port); err != nil {
			break
		}
		for _, v := range d.Services {
			if proxy.PortsConflict(host, port, v.ListenHost, v.ListenPort) {
				conflict = true
			}
		}
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return proxy.Draft{}, err
	}
	if conflict {
		return proxy.Draft{}, proxy.ErrConflict
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM engine_port_reservations WHERE engine_id=?`, id); err != nil {
		return proxy.Draft{}, err
	}
	for _, v := range reserved {
		if _, err = tx.ExecContext(ctx, `INSERT OR IGNORE INTO engine_port_reservations(node_id,engine_id,service_id,listen_host,listen_port) VALUES(?,?,?,?,?)`, e.NodeID, id, v.ID, v.ListenHost, v.ListenPort); err != nil {
			return proxy.Draft{}, err
		}
	}
	raw, err := json.Marshal(d.Services)
	if err != nil {
		return proxy.Draft{}, err
	}
	d.Version++
	d.UpdatedBy = actor
	d.UpdatedAt = now()
	if _, err = tx.ExecContext(ctx, `INSERT INTO engine_drafts(engine_id,version,services_json,updated_by,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(engine_id) DO UPDATE SET version=excluded.version,services_json=excluded.services_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at`, id, d.Version, string(raw), actor, d.UpdatedAt); err != nil {
		return proxy.Draft{}, err
	}
	if err = audit(ctx, tx, actor, "engine.draft.save", "engine", id); err != nil {
		return proxy.Draft{}, err
	}
	if err = s.commitChanges(tx, realtime.Change{Kind: "node", NodeID: e.NodeID}); err != nil {
		return proxy.Draft{}, err
	}
	return d, nil
}

type EngineGrant = proxy.Grant

func (s *Store) SetEngineGrant(ctx context.Context, actor, node string, g EngineGrant) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var role string
	if err = tx.QueryRowContext(ctx, `SELECT role FROM users WHERE id=? AND disabled=0`, actor).Scan(&role); err != nil || role != "admin" {
		return proxy.ErrForbidden
	}
	var exists bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM nodes WHERE id=?) AND EXISTS(SELECT 1 FROM users WHERE id=? AND disabled=0)`, node, g.UserID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return auth.ErrNotFound
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO engine_node_grants(user_id,node_id,can_manage,can_export) VALUES(?,?,?,?) ON CONFLICT(user_id,node_id) DO UPDATE SET can_manage=excluded.can_manage,can_export=excluded.can_export`, g.UserID, node, g.CanManage, g.CanExport); err != nil {
		return err
	}
	if err = audit(ctx, tx, actor, "engine.access.grant", "node", node); err != nil {
		return err
	}
	return tx.Commit()
}
