package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/proxy"
	v1 "github.com/vioira/viorka/protocol/v1"
)

// recoverEngines runs inside enrollment's transaction. Existing ownership is
// never transferred, and retries cannot overwrite drafts or effective secrets.
func (s *Store) recoverEngines(ctx context.Context, tx *sql.Tx, node string, items []*v1.EngineRecovery) error {
	if err := v1.ValidateEngineRecovery(items); err != nil {
		return auth.ErrInvalid
	}
	var actor string
	if len(items) == 0 {
		return nil
	}
	if err := tx.QueryRowContext(ctx, `SELECT created_by FROM nodes WHERE id=?`, node).Scan(&actor); err != nil {
		return err
	}
	for _, item := range items {
		c := *item.Command
		var owner, name string
		err := tx.QueryRowContext(ctx, `SELECT node_id,name FROM engines WHERE id=?`, item.EngineID).Scan(&owner, &name)
		if err == nil {
			if owner != node || name != c.Name {
				return proxy.ErrConflict
			}
			continue
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		var occupied bool
		if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM engines WHERE node_id=? AND name=?)`, node, c.Name).Scan(&occupied); err != nil {
			return err
		}
		if occupied {
			return proxy.ErrConflict
		}
		d := proxy.Draft{Version: 1, Services: []proxy.Service{}, UpdatedBy: actor, UpdatedAt: now()}
		credentials := map[string]engineCredential{}
		for _, service := range c.Services {
			d.Services = append(d.Services, proxy.Service{ID: service.ID, Name: service.Name, Enabled: service.Enabled, ListenHost: service.ListenHost, ListenPort: int(service.ListenPort), TargetHost: service.TargetHost, TargetPort: int(service.TargetPort), ServerName: service.ServerName})
			if c.Name != "realm" {
				credentials[service.ID] = engineCredential{UUID: service.Uuid, PrivateKey: service.PrivateKey, ShortIDs: service.ShortIds}
			}
		}
		if c.Routing != nil {
			raw, err := json.Marshal(c.Routing)
			if err != nil {
				return err
			}
			if err = json.Unmarshal(raw, &d.Routing); err != nil {
				return err
			}
			// Recovery creates independent outbound records: it must not overwrite
			// shared credentials or implicitly grant access to another node's exits.
			mapping := map[string]string{}
			for _, outbound := range c.Outbounds {
				raw, err = json.Marshal(outbound)
				if err != nil {
					return err
				}
				var config proxy.OutboundConfig
				if err = json.Unmarshal(raw, &config); err != nil {
					return err
				}
				old := config.ID
				config.ID = auth.Random()
				mapping[old] = config.ID
				if err = config.Validate(); err != nil {
					return proxy.ErrInvalid
				}
				raw, err = json.Marshal(config)
				if err != nil {
					return err
				}
				encrypted, err := s.sealEngine("outbound:"+config.ID, raw)
				if err != nil {
					return err
				}
				if _, err = tx.ExecContext(ctx, `INSERT INTO outbound_configs(id,name,version,config_encrypted,created_at) VALUES(?,?,1,?,?)`, config.ID, config.Name, encrypted, now()); err != nil {
					return err
				}
			}
			for i, id := range d.Routing.OutboundIds {
				d.Routing.OutboundIds[i] = mapping[id]
			}
			if id, ok := mapping[d.Routing.Final]; ok {
				d.Routing.Final = id
			}
			for _, rule := range d.Routing.Rules {
				if id, ok := mapping[rule.Outbound]; ok {
					rule.Outbound = id
				}
			}
		}
		if err = s.restoreEngineMetadata(ctx, tx, item.EngineID, c, &d); err != nil {
			return err
		}
		target := engineTarget{ID: item.EngineID, Node: node, Actor: actor, Revision: int64(c.Revision), Command: c, Draft: d, Credentials: credentials}
		if err = checkTargetPorts(ctx, tx, target); err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO engines(id,node_id,name,version,ownership,status,run_intent,desired_revision,observed_revision,observed_at) VALUES(?,?,?,?,'managed',?,?,?,?,?)`, item.EngineID, node, c.Name, c.Version, item.Status, c.RunIntent, c.Revision, c.Revision, now()); err != nil {
			return err
		}
		services, err := json.Marshal(d.Services)
		if err != nil {
			return err
		}
		routing, err := json.Marshal(d.Routing)
		if err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO engine_drafts(engine_id,version,services_json,routing_json,updated_by,updated_at) VALUES(?,1,?,?,?,?)`, item.EngineID, string(services), string(routing), actor, now()); err != nil {
			return err
		}
		raw, err := json.Marshal(credentials)
		if err != nil {
			return err
		}
		encrypted, err := s.sealEngine(item.EngineID, raw)
		if err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO engine_credentials(engine_id,encrypted) VALUES(?,?)`, item.EngineID, encrypted); err != nil {
			return err
		}
		if err = s.writeTarget(ctx, tx, target, true); err != nil {
			return err
		}
		if err = reserveTarget(ctx, tx, target); err != nil {
			return err
		}
		if err = audit(ctx, tx, actor, "engine.recover", "engine", item.EngineID); err != nil {
			return err
		}
	}
	return nil
}
