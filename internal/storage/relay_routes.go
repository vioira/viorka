package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/netip"
	"slices"
	"strconv"
	"strings"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/proxy"
	"github.com/vioira/viorka/internal/realtime"
	"github.com/vioira/viorka/internal/subscription"
	v1 "github.com/vioira/viorka/protocol/v1"
)

// A path binds a non-secret description to the exact exported connection.
// Fingerprints stay in storage, including when a route is returned by REST.
type relayPath struct {
	proxy.RelayPath
	Fingerprint string `json:"fingerprint"`
}

func (p relayPath) rule(id string) proxy.Service {
	return proxy.Service{ID: id, Name: p.Name, Enabled: true, ListenHost: p.Listen.Host, ListenPort: p.Listen.Port, PublicHost: p.Public.Host, PublicPort: p.Public.Port, TargetHost: p.Dial.Host, TargetPort: p.Dial.Port}
}
func canonicalRelayHost(host string) string {
	if ip, err := netip.ParseAddr(host); err == nil {
		return ip.Unmap().String()
	}
	return strings.ToLower(host)
}

const runningRelayLanding = `e.status='running' AND e.run_intent='running' AND EXISTS(
 SELECT 1 FROM engine_targets t WHERE t.engine_id=e.id AND t.sync_error='' AND e.observed_revision>=t.revision)`

func relayLanding(ctx context.Context, s *Store, tx *sql.Tx, actor string, edit proxy.RelayEdit) (relayPath, subscription.ClientNode, error) {
	var path relayPath
	var node subscription.ClientNode
	connections, err := s.engineConnectionsTx(ctx, tx, actor, edit.LandingEngineID)
	if err != nil {
		return path, node, err
	}
	var e subscriptionEngine
	var running bool
	err = tx.QueryRowContext(ctx, `SELECT e.id,e.node_id,e.name,coalesce(e.version,''),n.name,
		(`+runningRelayLanding+`)
		FROM engines e JOIN nodes n ON n.id=e.node_id WHERE e.id=?`, edit.LandingEngineID).Scan(&e.ID, &e.NodeID, &e.Name, &e.Version, &e.NodeName, &running)
	if err != nil {
		return path, node, err
	}
	if !running {
		return path, node, proxy.ErrConflict
	}
	for _, c := range connections {
		if c.ServiceID != edit.LandingServiceID {
			continue
		}
		_, client, err := subscriptionConnection(e, c)
		if err != nil {
			return path, node, err
		}
		edit.LandingRevision = c.Revision
		path = relayPath{RelayPath: proxy.RelayPath{RelayEdit: edit, Dial: proxy.Endpoint{Host: client.Host, Port: client.Port}, LandingListen: c.Listen, LandingName: c.Name}, Fingerprint: digestJSON([]any{client.Host, client.Port, client.UUID, client.ServerName, client.PublicKey, client.ShortID, c.Listen})}
		return path, client, nil
	}
	return path, node, proxy.ErrRelayLanding
}

func relayEngine(ctx context.Context, tx *sql.Tx, id string) (proxy.Engine, error) {
	return scanEngine(tx.QueryRowContext(ctx, `SELECT `+engineColumns+` FROM engines e LEFT JOIN engine_drafts d ON d.engine_id=e.id WHERE e.id=? AND e.name='realm' AND e.ownership='managed'`, id))
}
func lockRelayEngine(ctx context.Context, tx *sql.Tx, id string) error {
	// Use the same node lock/order as ordinary engine actions, including on PG.
	if _, err := tx.ExecContext(ctx, `UPDATE nodes SET state=state WHERE id=(SELECT node_id FROM engines WHERE id=?)`, id); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `UPDATE engines SET id=id WHERE id=?`, id)
	return err
}
func relayEngineReady(ctx context.Context, tx *sql.Tx, e proxy.Engine) error {
	var osName, arch string
	var capable, isolated bool
	if err := tx.QueryRowContext(ctx, `SELECT os,arch,engine_capable,EXISTS(SELECT 1 FROM subscription_restore_engines WHERE engine_id=? AND (state!='matched' OR draft_needs_review=1)) FROM nodes WHERE id=?`, e.ID, e.NodeID).Scan(&osName, &arch, &capable, &isolated); err != nil {
		return err
	}
	if _, ok := v1.EngineReleaseFor("realm", e.Version, arch); !ok || osName != "linux" || !capable || isolated {
		return proxy.ErrUnavailable
	}
	if e.Status != "installed" && e.Status != "running" && e.Status != "stopped" {
		return proxy.ErrUnavailable
	}
	return nil
}
func (s *Store) RelayEntries(ctx context.Context, actor, after string) ([]proxy.RelayEntry, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT e.id,e.node_id,n.name,coalesce(nullif(json_extract(n.inventory_json,'$.public_ipv4'),''),json_extract(n.inventory_json,'$.public_ipv6'),'') FROM engines e JOIN nodes n ON n.id=e.node_id JOIN users u ON u.id=? AND u.disabled=0 WHERE e.id>? AND e.version=? AND e.name='realm' AND e.ownership='managed' AND e.status IN ('installed','running','stopped') AND n.engine_capable=1 AND n.os='linux' AND n.arch IN ('amd64','arm64') AND NOT EXISTS(SELECT 1 FROM subscription_restore_engines r WHERE r.engine_id=e.id AND (r.state!='matched' OR r.draft_needs_review=1)) AND (u.role='admin' OR (u.role='operator' AND EXISTS(SELECT 1 FROM engine_node_grants g WHERE g.user_id=u.id AND g.node_id=n.id AND g.can_manage=1))) ORDER BY e.id LIMIT 50`, actor, after, v1.EngineVersion("realm"))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []proxy.RelayEntry{}
	for rows.Next() {
		var item proxy.RelayEntry
		if err = rows.Scan(&item.ID, &item.NodeID, &item.Name, &item.PublicHost); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// SQLite serializes writes. On PostgreSQL both ordinary and managed-rule
// publishers take the same endpoint locks before comparing their target snapshots.
func (s *Store) lockPublicEndpoints(ctx context.Context, tx *sql.Tx, services []proxy.Service) error {
	if !s.postgres {
		return nil
	}
	keys := make([]string, 0, len(services))
	for _, service := range services {
		if service.PublicHost != "" && service.PublicPort > 0 {
			keys = append(keys, canonicalRelayHost(service.PublicHost)+"/"+strconv.Itoa(service.PublicPort))
		}
	}
	slices.Sort(keys)
	for _, key := range slices.Compact(keys) {
		if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(1952803954,hashtext(?))`, key); err != nil {
			return err
		}
	}
	return nil
}

func protectRelayPublicEndpoints(ctx context.Context, tx *sql.Tx, engine string, d proxy.Draft) error {
	for _, svc := range d.Services {
		if svc.PublicHost == "" || svc.PublicPort == 0 {
			continue
		}
		var conflict bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM relay_public_bindings b JOIN relay_routes r ON r.id=b.route_id WHERE b.host=? AND b.port=? AND (r.engine_id!=? OR r.id!=?))`, canonicalRelayHost(svc.PublicHost), svc.PublicPort, engine, svc.ID).Scan(&conflict); err != nil {
			return err
		}
		if conflict {
			return proxy.ErrRelayMapping
		}
	}
	return nil
}

func relayMapping(ctx context.Context, tx *sql.Tx, id, node string, path relayPath) error {
	// A provider mapping names a concrete private interface; a wildcard bind on
	// that node can serve it. Compare address families as well as ports.
	rows, err := tx.QueryContext(ctx, `SELECT node_id,private_host,private_port FROM port_allocations
  WHERE transport='tcp' AND state!='inactive' AND lower(public_host)=? AND public_port=?`, path.Public.Host, path.Public.Port)
	if err != nil {
		return err
	}
	defer rows.Close()
	listener, err := netip.ParseAddr(path.Listen.Host)
	if err != nil {
		return proxy.ErrInvalid
	}
	for rows.Next() {
		var owner, host string
		var port int
		if err := rows.Scan(&owner, &host, &port); err != nil {
			return err
		}
		mapped, err := netip.ParseAddr(host)
		if err != nil || owner != node || port != path.Listen.Port {
			return proxy.ErrRelayMapping
		}
		mapped = mapped.Unmap()
		wildcard := listener.IsUnspecified() && (listener.Is6() || mapped.Is4())
		if listener != mapped && !wildcard {
			return proxy.ErrRelayMapping
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	var occupied bool
	err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM relay_public_bindings WHERE host=? AND port=? AND route_id!=?)
  OR EXISTS(SELECT 1 FROM engine_targets t CROSS JOIN json_each(t.public_snapshot,'$.services') v
		  WHERE lower(json_extract(v.value,'$.public_host'))=? AND CAST(json_extract(v.value,'$.public_port') AS INTEGER)=?
		  AND (t.engine_id!=? OR json_extract(v.value,'$.id')!=?))`,
		path.Public.Host, path.Public.Port, id, path.Public.Host, path.Public.Port, path.EngineID, id).Scan(&occupied)
	if err != nil {
		return err
	}
	if occupied {
		return proxy.ErrRelayMapping
	}
	return nil
}
func (s *Store) SaveRelay(ctx context.Context, actor, id string, edit proxy.RelayEdit) (proxy.RelayRoute, error) {
	var out proxy.RelayRoute
	if !proxy.ValidID(edit.EngineID) || !proxy.ValidID(edit.LandingEngineID) || !proxy.ValidID(edit.LandingServiceID) || edit.EngineID == edit.LandingEngineID || edit.Public.Host == "" || edit.LandingRevision < 1 || edit.Version < 0 {
		return out, proxy.ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = lockRelayEngine(ctx, tx, edit.EngineID); err != nil {
		return out, err
	}
	e, err := relayEngine(ctx, tx, edit.EngineID)
	if err != nil {
		return out, err
	}
	if err = engineAccess(ctx, tx, actor, e.NodeID, true); err != nil {
		return out, err
	}
	if err = relayEngineReady(ctx, tx, e); err != nil {
		return out, err
	}
	edit.Public.Host = canonicalRelayHost(edit.Public.Host)
	path, _, err := relayLanding(ctx, s, tx, actor, edit)
	if err != nil {
		return out, err
	}
	if path.LandingRevision != edit.LandingRevision {
		return out, proxy.ErrRelayLanding
	}
	if path.Public.Host == canonicalRelayHost(path.Dial.Host) && path.Public.Port == path.Dial.Port {
		return out, proxy.ErrInvalid
	}
	if id == "" {
		if edit.Version != 0 {
			return out, proxy.ErrRelayRevision
		}
		id = auth.Random()
	} else if edit.Version == 0 {
		return out, proxy.ErrRelayRevision
	}
	if ip, parseErr := netip.ParseAddr(path.Dial.Host); (parseErr == nil && ip.IsLoopback()) || strings.EqualFold(path.Dial.Host, "localhost") {
		var node string
		if err = tx.QueryRowContext(ctx, `SELECT node_id FROM engines WHERE id=?`, edit.LandingEngineID).Scan(&node); err != nil {
			return out, err
		}
		if node != e.NodeID {
			return out, proxy.ErrRelayLanding
		}
	}
	rule := path.rule(id)
	d := proxy.Draft{Services: mergeRelayRule(e.Draft.Services, rule, false)}
	if err = checkTargetPorts(ctx, tx, engineTarget{ID: e.ID, Node: e.NodeID, Command: v1.EngineCommand{Name: "realm"}, Draft: d}); err != nil {
		return out, err
	}
	if err = relayMapping(ctx, tx, id, e.NodeID, path); err != nil {
		return out, err
	}
	path.Version++
	raw, err := json.Marshal(path)
	if err != nil {
		return out, err
	}
	if edit.Version == 0 {
		var count int
		if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM relay_routes WHERE engine_id=? AND deleted=0`, e.ID).Scan(&count); err != nil {
			return out, err
		}
		if count >= proxy.MaxServices {
			return out, proxy.ErrConflict
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO relay_routes(id,engine_id,landing_engine_id,landing_service_id,draft_version,draft_json) VALUES(?,?,?,?,1,?)`, id, e.ID, edit.LandingEngineID, edit.LandingServiceID, string(raw))
	} else {
		prev, _, accessErr := s.relayDetailTx(ctx, tx, actor, id, false)
		if accessErr != nil {
			return out, accessErr
		}
		if prev.CleanupOnly {
			return out, proxy.ErrForbidden
		}
		if prev.Draft.Version != edit.Version || prev.Draft.EngineID != edit.EngineID {
			return out, proxy.ErrRelayRevision
		}
		comparison := path
		comparison.Version = edit.Version
		if prev.Draft == comparison.RelayPath {
			var fingerprint string
			if err := tx.QueryRowContext(ctx, `SELECT json_extract(draft_json,'$.fingerprint') FROM relay_routes WHERE id=?`, id).Scan(&fingerprint); err != nil {
				return out, err
			}
			if fingerprint == comparison.Fingerprint {
				return prev, tx.Commit()
			}
		}
		var result sql.Result
		result, err = tx.ExecContext(ctx, `UPDATE relay_routes SET draft_version=draft_version+1,draft_json=?,landing_engine_id=?,landing_service_id=? WHERE id=? AND engine_id=? AND draft_version=? AND deleted=0`, string(raw), edit.LandingEngineID, edit.LandingServiceID, id, e.ID, edit.Version)
		if err == nil {
			if n, err := result.RowsAffected(); err != nil {
				return out, err
			} else if n != 1 {
				return out, proxy.ErrRelayRevision
			}
		}
	}
	if err != nil {
		return out, err
	}
	if err = audit(ctx, tx, actor, "relay.draft.save", "relay", id); err != nil {
		return out, err
	}
	out, _, err = s.relayDetailTx(ctx, tx, actor, id, false)
	if err != nil {
		return out, err
	}
	return out, s.commitChanges(tx, realtime.Change{Kind: "engines", NodeID: e.NodeID, EngineID: e.ID})
}

func (s *Store) RelayLanding(ctx context.Context, actor, engine, service string) (proxy.RelayPath, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return proxy.RelayPath{}, err
	}
	defer tx.Rollback()
	p, _, err := relayLanding(ctx, s, tx, actor, proxy.RelayEdit{LandingEngineID: engine, LandingServiceID: service})
	if err != nil {
		return proxy.RelayPath{}, err
	}
	return p.RelayPath, tx.Commit()
}
func (s *Store) RelayRoute(ctx context.Context, actor, id string) (proxy.RelayRoute, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return proxy.RelayRoute{}, err
	}
	defer tx.Rollback()
	r, _, err := s.relayDetailTx(ctx, tx, actor, id, false)
	if err != nil {
		return proxy.RelayRoute{}, err
	}
	return r, tx.Commit()
}
func (s *Store) DeleteRelay(ctx context.Context, actor, id string, version int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var node, engine string
	err = tx.QueryRowContext(ctx, `SELECT e.node_id,e.id FROM relay_routes r JOIN engines e ON e.id=r.engine_id WHERE r.id=? AND r.deleted=0`, id).Scan(&node, &engine)
	if errors.Is(err, sql.ErrNoRows) {
		return auth.ErrNotFound
	}
	if err != nil {
		return err
	}
	if err = lockRelayEngine(ctx, tx, engine); err != nil {
		return err
	}
	if err = engineAccess(ctx, tx, actor, node, true); err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, `UPDATE relay_routes SET deleted=1 WHERE id=? AND draft_version=? AND deleted=0 AND (target_revision=0 OR EXISTS(SELECT 1 FROM relay_publications p JOIN tasks t ON t.id=p.task_id WHERE p.route_id=relay_routes.id AND p.revision=relay_routes.target_revision AND p.operation='withdraw' AND t.state='succeeded'))`, id, version)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n != 1 {
		return proxy.ErrConflict
	}
	if _, err = tx.ExecContext(ctx, `UPDATE subscription_service_links SET invalidated=1 WHERE node_id=? AND engine_id=? AND service_id=?`, node, engine, id); err != nil {
		return err
	}
	if err = audit(ctx, tx, actor, "relay.delete", "relay", id); err != nil {
		return err
	}
	return s.commitChanges(tx, realtime.Change{Kind: "engines", NodeID: node, EngineID: engine})
}
