package storage

import (
	"context"
	"crypto/ecdh"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net"
	"net/url"
	"strconv"

	"github.com/vioira/viorka/internal/proxy"
	v1 "github.com/vioira/viorka/protocol/v1"
)

type EngineConnection = proxy.Connection

// Queries using this predicate alias engine_operations as o. A historical
// publication cannot supply credentials or reserve ports on a replacement OS.
const currentInstallationOperation = `o.revision>(SELECT last_absent_revision FROM engines WHERE id=o.engine_id)`

func sameAppliedServices(a, b v1.EngineCommand) bool {
	// Run intent and the installed version can change without changing the
	// published service credentials or Panel-only endpoint metadata.
	a.Version, b.Version = "", ""
	a.RunIntent, b.RunIntent = "", ""
	a.AllowUnreachable, b.AllowUnreachable = false, false
	return canonicalCommand(a) == canonicalCommand(b)
}

func (s *Store) EngineConnections(ctx context.Context, actor, id string) ([]EngineConnection, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	connections, err := s.engineConnectionsTx(ctx, tx, actor, id)
	if err != nil {
		return nil, err
	}
	if err = audit(ctx, tx, actor, "engine.credentials.export", "engine", id); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return connections, nil
}

// engineConnectionsTx reads only the last confirmed applied snapshot while
// using the caller's transaction. This keeps multi-engine subscriptions
// consistent and avoids opening a nested transaction on the single SQLite
// connection. Its return value contains client credentials and is never a DTO.
func (s *Store) engineConnectionsTx(ctx context.Context, tx *sql.Tx, actor, id string) ([]EngineConnection, error) {
	e, err := scanEngine(tx.QueryRowContext(ctx, `SELECT `+engineColumns+` FROM engines e LEFT JOIN engine_drafts d ON d.engine_id=e.id WHERE e.id=?`, id))
	if err != nil {
		return nil, err
	}
	if err = engineAccess(ctx, tx, actor, e.NodeID, false); err != nil {
		return nil, err
	}
	var allowed bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id=? AND role='admin' AND disabled=0) OR EXISTS(SELECT 1 FROM engine_node_grants WHERE user_id=? AND node_id=? AND can_export=1)`, actor, actor, e.NodeID).Scan(&allowed); err != nil {
		return nil, err
	}
	if !allowed {
		return nil, proxy.ErrForbidden
	}
	if e.Name == "realm" || e.Ownership != "managed" || e.Status == "not_installed" {
		return nil, proxy.ErrInvalid
	}
	var recoveryState, observedSealed, reason string
	var observedRevision int64
	recoveryErr := tx.QueryRowContext(ctx, `SELECT state,observed_encrypted,observed_revision,reason FROM subscription_restore_engines WHERE engine_id=?`, id).Scan(&recoveryState, &observedSealed, &observedRevision, &reason)
	if recoveryErr != nil && !errors.Is(recoveryErr, sql.ErrNoRows) {
		return nil, recoveryErr
	}
	if recoveryErr == nil && (recoveryState != "matched" || reason == "reenrollment" && observedSealed == "") {
		return nil, proxy.ErrConflict
	}
	// An uninstall deletes the target, but historical successful operations are
	// retained. Never export those historical credentials after an uninstall.
	target, targetErr := s.readTarget(ctx, tx, id)
	if errors.Is(targetErr, sql.ErrNoRows) {
		return nil, proxy.ErrConflict
	}
	if targetErr != nil {
		return nil, targetErr
	}
	var raw, sealed, commandSealed string
	var revision int64
	err = tx.QueryRowContext(ctx, `SELECT o.public_snapshot,o.credential_encrypted,o.command_encrypted,o.revision FROM engine_operations o JOIN tasks t ON t.id=o.task_id WHERE o.engine_id=? AND o.operation='engine.apply' AND `+currentInstallationOperation+` AND t.state='succeeded' ORDER BY o.revision DESC LIMIT 1`, id).Scan(&raw, &sealed, &commandSealed, &revision)
	if errors.Is(err, sql.ErrNoRows) && recoveryErr == nil && observedRevision > 0 {
		err = nil // The post-restore authenticated observation is the source.
	} else if errors.Is(err, sql.ErrNoRows) {
		// Enrollment recovery has a confirmed snapshot but no fabricated task.
		err = tx.QueryRowContext(ctx, `SELECT public_snapshot,credential_encrypted,command_encrypted,revision FROM engine_targets WHERE engine_id=? AND revision<=?`, id, e.ObservedRevision).Scan(&raw, &sealed, &commandSealed, &revision)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, proxy.ErrConflict
		}
	}
	if err != nil {
		return nil, err
	}
	var draft proxy.Draft
	var credentials map[string]engineCredential
	var applied v1.EngineCommand
	if recoveryErr == nil && observedRevision >= revision {
		observedRaw, err := s.openEngine(id, observedSealed)
		if err != nil {
			return nil, err
		}
		var observed v1.EngineRecovery
		if err = json.Unmarshal(observedRaw, &observed); err != nil || v1.ValidateRecoveryObservation(id, &observed) != nil || int64(observed.Command.Revision) != observedRevision {
			return nil, proxy.ErrConflict
		}
		applied = *observed.Command
		revision = observedRevision
		credentials = map[string]engineCredential{}
		for _, service := range observed.Command.Services {
			v := proxy.Service{ID: service.ID, Name: service.Name, Enabled: service.Enabled, ServerName: service.ServerName}
			var host string
			var port int
			e := tx.QueryRowContext(ctx, `SELECT public_host,public_port FROM subscription_restore_endpoints WHERE engine_id=? AND service_id=?`, id, service.ID).Scan(&host, &port)
			if e != nil && !errors.Is(e, sql.ErrNoRows) {
				return nil, e
			}
			v.PublicHost, v.PublicPort = host, port
			draft.Services = append(draft.Services, v)
			credentials[service.ID] = engineCredential{UUID: service.Uuid, PrivateKey: service.PrivateKey, ShortIDs: service.ShortIds}
		}
	} else {
		plaintext, err := s.openEngine(id, sealed)
		if err != nil {
			return nil, err
		}
		if err = json.Unmarshal([]byte(raw), &draft); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(plaintext, &credentials); err != nil {
			return nil, err
		}
		commandRaw, err := s.openEngine(id, commandSealed)
		if err != nil {
			return nil, err
		}
		if err = json.Unmarshal(commandRaw, &applied); err != nil {
			return nil, err
		}
	}
	// Endpoint-only publication updates Panel metadata without changing the
	// applied command. Start/stop may independently advance the target revision.
	// Compare effective commands instead of requiring identical revision numbers.
	if target.Error == "" && target.Revision <= e.ObservedRevision && sameAppliedServices(target.Command, applied) {
		for i := range draft.Services {
			for _, service := range target.Draft.Services {
				if service.ID == draft.Services[i].ID {
					draft.Services[i].PublicHost = service.PublicHost
					draft.Services[i].PublicPort = service.PublicPort
				}
			}
		}
	}
	connections := []EngineConnection{}
	for _, service := range draft.Services {
		if !service.Enabled || service.PendingDelete || service.PublicHost == "" {
			continue
		}
		if recoveryErr == nil {
			var confirmed bool
			if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM subscription_restore_endpoints WHERE engine_id=? AND service_id=? AND public_host=? AND public_port=?)`, id, service.ID, service.PublicHost, service.PublicPort).Scan(&confirmed); err != nil {
				return nil, err
			}
			if !confirmed {
				continue
			}
		}
		credential, ok := credentials[service.ID]
		if !ok {
			return nil, proxy.ErrConflict
		}
		if len(credential.ShortIDs) == 0 {
			return nil, proxy.ErrConflict
		}
		keyBytes, err := base64.RawURLEncoding.DecodeString(credential.PrivateKey)
		if err != nil {
			return nil, err
		}
		key, err := ecdh.X25519().NewPrivateKey(keyBytes)
		if err != nil {
			return nil, err
		}
		query := url.Values{"encryption": {"none"}, "security": {"reality"}, "type": {"tcp"}, "flow": {"xtls-rprx-vision"}, "sni": {service.ServerName}, "fp": {"chrome"}, "pbk": {base64.RawURLEncoding.EncodeToString(key.PublicKey().Bytes())}, "sid": {credential.ShortIDs[0]}}
		u := url.URL{Scheme: "vless", User: url.User(credential.UUID), Host: net.JoinHostPort(service.PublicHost, strconv.Itoa(service.PublicPort)), RawQuery: query.Encode(), Fragment: service.Name}
		connections = append(connections, EngineConnection{ServiceID: service.ID, Name: service.Name, URL: u.String(), Revision: revision, RuntimeStatus: e.Status, ExternalConnectivity: "unverified"})
	}
	return connections, nil
}
