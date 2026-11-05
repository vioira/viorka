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
	v1 "github.com/vioira/viorka/protocol/v1"
)

type engineTarget struct {
	ID, Node, Actor, Error string
	Revision               int64
	Command                v1.EngineCommand
	Draft                  proxy.Draft
	Credentials            map[string]engineCredential
}

func (s *Store) readTarget(ctx context.Context, q engineQuery, id string) (engineTarget, error) {
	t := engineTarget{ID: id}
	var command, snapshot, credentials string
	err := q.QueryRowContext(ctx, `SELECT e.node_id,t.revision,t.command_encrypted,t.public_snapshot,t.credential_encrypted,t.updated_by,t.sync_error FROM engine_targets t JOIN engines e ON e.id=t.engine_id WHERE t.engine_id=?`, id).Scan(&t.Node, &t.Revision, &command, &snapshot, &credentials, &t.Actor, &t.Error)
	if err != nil {
		return t, err
	}
	b, err := s.openEngine(id, command)
	if err != nil {
		return t, err
	}
	if err = json.Unmarshal(b, &t.Command); err != nil {
		return t, err
	}
	b, err = s.openEngine(id, credentials)
	if err != nil {
		return t, err
	}
	if err = json.Unmarshal(b, &t.Credentials); err != nil {
		return t, err
	}
	err = json.Unmarshal([]byte(snapshot), &t.Draft)
	return t, err
}

func digestJSON(v any) string {
	b, _ := json.Marshal(v)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

func (s *Store) writeTarget(ctx context.Context, tx *sql.Tx, t engineTarget, revisionRecord bool) error {
	t.Command.Revision = uint64(t.Revision)
	raw, err := json.Marshal(t.Command)
	if err != nil {
		return err
	}
	command, err := s.sealEngine(t.ID, raw)
	if err != nil {
		return err
	}
	rawCredentials, err := json.Marshal(t.Credentials)
	if err != nil {
		return err
	}
	credentials, err := s.sealEngine(t.ID, rawCredentials)
	if err != nil {
		return err
	}
	snapshot, err := json.Marshal(t.Draft)
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO engine_targets(engine_id,revision,command_encrypted,public_snapshot,credential_encrypted,updated_by,sync_error) VALUES(?,?,?,?,?,?,?) ON CONFLICT(engine_id) DO UPDATE SET revision=excluded.revision,command_encrypted=excluded.command_encrypted,public_snapshot=excluded.public_snapshot,credential_encrypted=excluded.credential_encrypted,updated_by=excluded.updated_by,sync_error=excluded.sync_error`, t.ID, t.Revision, command, string(snapshot), credentials, t.Actor, t.Error); err != nil {
		return err
	}
	if revisionRecord {
		if _, err = tx.ExecContext(ctx, `INSERT INTO config_revisions(id,node_id,resource_kind,resource_id,revision,sha256,desired_json,created_by,created_at) VALUES(?,?,'engine',?,?,?,?,?,?)`, auth.Random(), t.Node, t.ID, t.Revision, digestJSON(t.Command), command, t.Actor, now()); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `UPDATE engines SET desired_revision=? WHERE id=?`, t.Revision, t.ID)
	}
	return err
}

// checkTargetPorts checks the complete target and retains existing reservations
// until successful application. No network operations occur in this transaction.
func checkTargetPorts(ctx context.Context, tx *sql.Tx, t engineTarget) error {
	if err := proxy.ValidateDraft(t.Command.Name, t.Draft); err != nil {
		return err
	}
	rows, err := tx.QueryContext(ctx, `SELECT engine_id,service_id,listen_host,listen_port FROM engine_port_reservations WHERE node_id=? UNION ALL SELECT '',id,listen_host,listen_port FROM proxy_services WHERE node_id=? UNION ALL SELECT '',id,listen_host,listen_port FROM relay_rules WHERE source_node_id=?`, t.Node, t.Node, t.Node)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var engine, service, host string
		var port int
		if err = rows.Scan(&engine, &service, &host, &port); err != nil {
			return err
		}
		for _, v := range t.Draft.Services {
			if engine == t.ID && service == v.ID {
				continue
			}
			if proxy.PortsConflict(host, port, v.ListenHost, v.ListenPort) {
				return proxy.ErrConflict
			}
		}
	}
	return rows.Err()
}

func reserveTarget(ctx context.Context, tx *sql.Tx, t engineTarget) error {
	for _, v := range t.Draft.Services {
		if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO engine_port_reservations(node_id,engine_id,service_id,listen_host,listen_port) VALUES(?,?,?,?,?)`, t.Node, t.ID, v.ID, v.ListenHost, v.ListenPort); err != nil {
			return err
		}
	}
	return nil
}

// reconcileEngineTargets runs only inside the authenticated online gateway claim.
// There is at most one active operation per engine. Offline edits create no tasks.
func (s *Store) reconcileEngineTargets(ctx context.Context, tx *sql.Tx, node string) error {
	rows, err := tx.QueryContext(ctx, `SELECT t.engine_id FROM engine_targets t JOIN engines e ON e.id=t.engine_id JOIN nodes n ON n.id=e.node_id WHERE e.node_id=? AND n.state='online' AND n.engine_capable=1 AND n.os='linux' AND e.ownership='managed' AND t.revision>e.observed_revision AND t.sync_error='' AND NOT EXISTS(SELECT 1 FROM engine_operations o WHERE o.engine_id=e.id AND o.active=1) ORDER BY e.id LIMIT 3`, node)
	if err != nil {
		return err
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
		return err
	}
	for _, id := range ids {
		t, err := s.readTarget(ctx, tx, id)
		if err != nil {
			return err
		}
		var status, arch string
		if err = tx.QueryRowContext(ctx, `SELECT e.status,n.arch FROM engines e JOIN nodes n ON n.id=e.node_id WHERE e.id=?`, id).Scan(&status, &arch); err != nil {
			return err
		}
		issue := ""
		if status == "unknown" || status == "degraded" || status == "not_installed" {
			issue = "engine_result_unknown"
		}
		if _, ok := v1.EngineReleaseFor(t.Command.Name, t.Command.Version, arch); !ok {
			issue = "engine_unsupported"
		}
		for _, service := range t.Draft.Services {
			if service.PresetID == "" {
				continue
			}
			p, presetErr := scanPreset(tx.QueryRowContext(ctx, `SELECT id,config_json,created_at FROM protocol_presets WHERE id=?`, service.PresetID))
			if presetErr != nil {
				return presetErr
			}
			if proxy.PresetReferenceIssue(t.Command.Name, p.Config) != "" {
				issue = "engine_unsupported"
			}
		}
		if t.Command.Validate("engine.apply") != nil {
			issue = "engine_invalid_config"
		}
		if err = checkTargetPorts(ctx, tx, t); err != nil {
			if !errors.Is(err, proxy.ErrConflict) && !errors.Is(err, proxy.ErrInvalid) {
				return err
			}
			issue = "engine_port_conflict"
		}
		if issue != "" {
			if _, err = tx.ExecContext(ctx, `UPDATE engine_targets SET sync_error=? WHERE engine_id=?`, issue, id); err != nil {
				return err
			}
			continue
		}
		if err = reserveTarget(ctx, tx, t); err != nil {
			return err
		}
		task := auth.Random()
		if _, err = tx.ExecContext(ctx, `INSERT INTO tasks(id,node_id,task_type,idempotency_key,revision,state,payload_json,created_at,updated_at,deadline_at,max_attempts) VALUES(?,?,'engine.apply',?,?,'queued','{}',?,?,?,10)`, task, node, "sync-"+task, t.Revision, now(), now(), at(time.Now().Add(5*time.Minute))); err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO engine_operations(task_id,engine_id,draft_version,command_encrypted,public_snapshot,credential_encrypted,operation,revision,request_json) SELECT ?,engine_id,-1,command_encrypted,public_snapshot,credential_encrypted,'engine.apply',revision,'{}' FROM engine_targets WHERE engine_id=?`, task, id); err != nil {
			return err
		}
		if err = audit(ctx, tx, t.Actor, "engine.sync", "engine", id); err != nil {
			return err
		}
	}
	return nil
}

// resolveDraftReferences refreshes inherited fields without publishing draft edits.
func resolveDraftReferences(ctx context.Context, q engineQuery, d *proxy.Draft) error {
	for i, v := range d.Services {
		if v.PresetID == "" {
			continue
		}
		p, err := scanPreset(q.QueryRowContext(ctx, `SELECT id,config_json,created_at FROM protocol_presets WHERE id=?`, v.PresetID))
		if err != nil {
			return err
		}
		if proxy.PresetReferenceable(p.Config) {
			d.Services[i] = proxy.ResolvePreset(v, p.Config)
		}
	}
	return nil
}

// Drop obsolete reservations only after success; retain drafts, latest desired,
// actual applied listeners and any operation still executing.
func refreshEngineReservations(ctx context.Context, tx *sql.Tx, id, node string) error {
	var raw string
	err := tx.QueryRowContext(ctx, `SELECT services_json FROM engine_drafts WHERE engine_id=?`, id).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	var draft proxy.Draft
	if err = json.Unmarshal([]byte(raw), &draft.Services); err != nil {
		return err
	}
	if err = resolveDraftReferences(ctx, tx, &draft); err != nil {
		return err
	}
	services := append([]proxy.Service{}, draft.Services...)
	rows, err := tx.QueryContext(ctx, `SELECT public_snapshot FROM engine_targets WHERE engine_id=? UNION ALL SELECT o.public_snapshot FROM engine_operations o JOIN tasks t ON t.id=o.task_id WHERE o.engine_id=? AND o.operation='engine.apply' AND (o.active=1 OR o.revision=(SELECT max(o2.revision) FROM engine_operations o2 JOIN tasks t2 ON t2.id=o2.task_id WHERE o2.engine_id=? AND o2.operation='engine.apply' AND t2.state='succeeded'))`, id, id, id)
	if err != nil {
		return err
	}
	for rows.Next() {
		var snapshot string
		if err = rows.Scan(&snapshot); err != nil {
			break
		}
		var d proxy.Draft
		if err = json.Unmarshal([]byte(snapshot), &d); err != nil {
			break
		}
		for _, v := range d.Services {
			if !v.PendingDelete {
				services = append(services, v)
			}
		}
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM engine_port_reservations WHERE engine_id=?`, id); err != nil {
		return err
	}
	// Draft edits can have become invalid after a shared preset change. Reserve
	// what is still free, while target validation continues to reject conflicts.
	for _, v := range services {
		if _, err = tx.ExecContext(ctx, `INSERT OR IGNORE INTO engine_port_reservations(node_id,engine_id,service_id,listen_host,listen_port) VALUES(?,?,?,?,?)`, node, id, v.ID, v.ListenHost, v.ListenPort); err != nil {
			return err
		}
	}
	return nil
}
