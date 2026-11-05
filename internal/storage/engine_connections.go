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
)

type EngineConnection = proxy.Connection

func (s *Store) EngineConnections(ctx context.Context, actor, id string) ([]EngineConnection, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
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
	if e.Name == "realm" {
		return nil, proxy.ErrInvalid
	}
	var raw, sealed string
	var revision int64
	err = tx.QueryRowContext(ctx, `SELECT o.public_snapshot,o.credential_encrypted,o.revision FROM engine_operations o JOIN tasks t ON t.id=o.task_id WHERE o.engine_id=? AND o.operation='engine.apply' AND t.state='succeeded' ORDER BY o.revision DESC LIMIT 1`, id).Scan(&raw, &sealed, &revision)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, proxy.ErrConflict
	}
	if err != nil {
		return nil, err
	}
	plaintext, err := s.openEngine(id, sealed)
	if err != nil {
		return nil, err
	}
	var draft proxy.Draft
	var credentials map[string]engineCredential
	if err = json.Unmarshal([]byte(raw), &draft); err != nil {
		return nil, err
	}
	if err = json.Unmarshal(plaintext, &credentials); err != nil {
		return nil, err
	}
	connections := []EngineConnection{}
	for _, service := range draft.Services {
		if !service.Enabled || service.PendingDelete || service.PublicHost == "" {
			continue
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
	if err = audit(ctx, tx, actor, "engine.credentials.export", "engine", id); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return connections, nil
}
