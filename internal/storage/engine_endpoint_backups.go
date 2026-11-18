package storage

import (
	"context"
	"encoding/json"

	"github.com/vioira/viorka/internal/proxy"
	v1 "github.com/vioira/viorka/protocol/v1"
)

// EngineEndpointBackups reads only published targets confirmed for this node.
// The command (including credentials) stays in Panel; only its digest is sent.
func (s *Store) EngineEndpointBackups(ctx context.Context, node string) ([]v1.EngineEndpointBackup, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `SELECT e.id,t.command_encrypted,t.public_snapshot,r.engine_id IS NOT NULL FROM engines e JOIN engine_targets t ON t.engine_id=e.id LEFT JOIN subscription_restore_engines r ON r.engine_id=e.id WHERE e.node_id=? AND e.ownership='managed' AND e.status!='not_installed' AND t.sync_error='' AND t.revision<=e.observed_revision AND (r.state IS NULL OR r.state='matched') ORDER BY e.id LIMIT 3`, node)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var backups []v1.EngineEndpointBackup
	var restored []int
	for rows.Next() {
		var id, sealed, raw string
		var needsConfirmation bool
		if err := rows.Scan(&id, &sealed, &raw, &needsConfirmation); err != nil {
			return nil, err
		}
		plaintext, err := s.openEngine(id, sealed)
		if err != nil {
			return nil, err
		}
		var c v1.EngineCommand
		if err := json.Unmarshal(plaintext, &c); err != nil {
			return nil, err
		}
		var draft proxy.Draft
		if err := json.Unmarshal([]byte(raw), &draft); err != nil {
			return nil, err
		}
		b := v1.EngineEndpointBackup{EngineID: id, Name: c.Name, CommandSHA256: v1.EndpointCommandDigest(c), Endpoints: []*v1.EnginePublicEndpoint{}}
		for _, service := range draft.Services {
			if service.PublicHost != "" && !service.PendingDelete {
				b.Endpoints = append(b.Endpoints, &v1.EnginePublicEndpoint{ServiceID: service.ID, Host: service.PublicHost, Port: uint64(service.PublicPort)})
			}
		}
		if !b.Matches(id, c) {
			return nil, proxy.ErrInvalid
		}
		if needsConfirmation {
			restored = append(restored, len(backups))
		}
		backups = append(backups, b)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, i := range restored {
		b := &backups[i]
		confirmed := b.Endpoints[:0]
		for _, ep := range b.Endpoints {
			var ok bool
			if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM subscription_restore_endpoints WHERE engine_id=? AND service_id=? AND public_host=? AND public_port=?)`, b.EngineID, ep.ServiceID, ep.Host, ep.Port).Scan(&ok); err != nil {
				return nil, err
			}
			if ok {
				confirmed = append(confirmed, ep)
			}
		}
		b.Endpoints = confirmed
	}
	return backups, tx.Commit()
}
