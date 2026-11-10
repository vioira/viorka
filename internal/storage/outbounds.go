package storage

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/proxy"
	"github.com/vioira/viorka/internal/realtime"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func (s *Store) readOutbound(ctx context.Context, q engineQuery, id string) (proxy.Outbound, error) {
	var o proxy.Outbound
	var encrypted string
	err := q.QueryRowContext(ctx, `SELECT id,version,config_encrypted FROM outbound_configs WHERE id=?`, id).Scan(&o.ID, &o.Version, &encrypted)
	if errors.Is(err, sql.ErrNoRows) {
		return o, auth.ErrNotFound
	}
	if err != nil {
		return o, err
	}
	b, err := s.openEngine("outbound:"+id, encrypted)
	if err != nil {
		return o, err
	}
	err = json.Unmarshal(b, &o.Config)
	return o, err
}
func redactOutbound(o proxy.Outbound) proxy.Outbound {
	o.HasPassword = o.Config.Password != ""
	o.HasUUID = o.Config.Uuid != ""
	o.Config.Password = ""
	o.Config.Uuid = ""
	return o
}
func (s *Store) Outbounds(ctx context.Context, actor, after string, limit int) ([]proxy.Outbound, error) {
	if err := presetAccess(ctx, s.db, actor, false); err != nil {
		return nil, err
	}
	if limit < 1 || limit > 100 || len(after) > 128 {
		return nil, proxy.ErrInvalid
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id FROM outbound_configs WHERE id>? ORDER BY id LIMIT ?`, after, limit)
	if err != nil {
		return nil, err
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
		return nil, err
	}
	result := []proxy.Outbound{}
	for _, id := range ids {
		o, e := s.readOutbound(ctx, s.db, id)
		if e != nil {
			return nil, e
		}
		e = s.db.QueryRowContext(ctx, `SELECT count(*) FROM engines e LEFT JOIN engine_drafts d ON d.engine_id=e.id LEFT JOIN engine_targets t ON t.engine_id=e.id WHERE EXISTS(SELECT 1 FROM json_each(d.routing_json,'$.outbound_ids') WHERE value=?) OR EXISTS(SELECT 1 FROM json_each(t.public_snapshot,'$.routing.outbound_ids') WHERE value=?)`, id, id).Scan(&o.References)
		if e != nil {
			return nil, e
		}
		result = append(result, redactOutbound(o))
	}
	return result, nil
}

type outboundQuery interface {
	engineQuery
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func (s *Store) outboundReferences(ctx context.Context, q outboundQuery, id string) ([]proxy.OutboundImpact, error) {
	rows, err := q.QueryContext(ctx, `SELECT e.id,e.node_id,n.name,n.state,NOT EXISTS(SELECT 1 FROM json_each(t.public_snapshot,'$.routing.outbound_ids') WHERE value=?) FROM engines e JOIN nodes n ON n.id=e.node_id LEFT JOIN engine_drafts d ON d.engine_id=e.id LEFT JOIN engine_targets t ON t.engine_id=e.id WHERE EXISTS(SELECT 1 FROM json_each(d.routing_json,'$.outbound_ids') WHERE value=?) OR EXISTS(SELECT 1 FROM json_each(t.public_snapshot,'$.routing.outbound_ids') WHERE value=?) ORDER BY e.id LIMIT 501`, id, id, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	refs := []proxy.OutboundImpact{}
	for rows.Next() {
		var r proxy.OutboundImpact
		if err = rows.Scan(&r.EngineID, &r.NodeID, &r.NodeName, &r.State, &r.DraftOnly); err != nil {
			return nil, err
		}
		refs = append(refs, r)
	}
	return refs, rows.Err()
}
func (s *Store) outboundConfig(ctx context.Context, tx *sql.Tx, actor, id string, edit proxy.OutboundEdit) (proxy.OutboundConfig, proxy.OutboundPreview, error) {
	preview := proxy.OutboundPreview{Impacts: []proxy.OutboundImpact{}}
	if err := presetAccess(ctx, tx, actor, true); err != nil {
		return edit.Config, preview, err
	}
	old, err := s.readOutbound(ctx, tx, id)
	if err != nil {
		return edit.Config, preview, err
	}
	if old.Version != edit.Version {
		return edit.Config, preview, proxy.ErrPresetStale
	}
	c := edit.Config
	c.ID = id
	if c.Type == old.Config.Type {
		if c.Username == "" {
			c.Password = ""
		} else if c.Password == "" {
			c.Password = old.Config.Password
		}
		if c.Uuid == "" {
			c.Uuid = old.Config.Uuid
		}
	}
	if c.Validate() != nil {
		return c, preview, proxy.ErrInvalid
	}
	refs, err := s.outboundReferences(ctx, tx, id)
	if err != nil {
		return c, preview, err
	}
	if len(refs) > 500 {
		return c, preview, proxy.ErrPresetLimit
	}
	fence := []any{actor, id, old.Version, c, refs}
	for _, r := range refs {
		if err = engineAccess(ctx, tx, actor, r.NodeID, true); err != nil {
			return c, preview, err
		}
		var version int64
		var routing string
		if err = tx.QueryRowContext(ctx, `SELECT version,routing_json FROM engine_drafts WHERE engine_id=?`, r.EngineID).Scan(&version, &routing); err != nil {
			return c, preview, err
		}
		var intent, engineVersion string
		var desired int64
		if err = tx.QueryRowContext(ctx, `SELECT run_intent,version,desired_revision FROM engines WHERE id=?`, r.EngineID).Scan(&intent, &engineVersion, &desired); err != nil {
			return c, preview, err
		}
		fence = append(fence, version, routing, intent, engineVersion, desired)
		if !r.DraftOnly {
			t, e := s.readTarget(ctx, tx, r.EngineID)
			if e != nil {
				return c, preview, e
			}
			fence = append(fence, t.Revision, canonicalCommand(t.Command))
			for i, o := range t.Command.Outbounds {
				if o.ID == id {
					copy := c
					t.Command.Outbounds[i] = wireOutbound(copy)
				}
			}
			if t.Command.Validate("engine.apply") != nil {
				return c, preview, proxy.ErrInvalid
			}
		}
	}
	preview.Impacts = refs
	mac := hmac.New(sha256.New, s.engineKey)
	mac.Write([]byte(digestJSON(fence)))
	preview.Confirmation = hex.EncodeToString(mac.Sum(nil))
	return c, preview, nil
}
func (s *Store) PreviewOutbound(ctx context.Context, actor, id string, edit proxy.OutboundEdit) (proxy.OutboundPreview, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return proxy.OutboundPreview{}, err
	}
	defer tx.Rollback()
	_, p, err := s.outboundConfig(ctx, tx, actor, id, edit)
	return p, err
}
func (s *Store) SaveOutbound(ctx context.Context, actor, id string, edit proxy.OutboundEdit) (proxy.Outbound, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return proxy.Outbound{}, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `UPDATE outbound_configs SET id=id WHERE id=?`, id); err != nil {
		return proxy.Outbound{}, err
	}
	c := edit.Config
	version := int64(1)
	refs := []proxy.OutboundImpact{}
	if id == "" {
		if err = presetAccess(ctx, tx, actor, true); err != nil {
			return proxy.Outbound{}, err
		}
		id = auth.Random()
		c.ID = id
		if c.Validate() != nil {
			return proxy.Outbound{}, proxy.ErrInvalid
		}
	} else {
		var preview proxy.OutboundPreview
		c, preview, err = s.outboundConfig(ctx, tx, actor, id, edit)
		if err != nil {
			return proxy.Outbound{}, err
		}
		if edit.Confirmation == "" || !hmac.Equal([]byte(preview.Confirmation), []byte(edit.Confirmation)) {
			return proxy.Outbound{}, proxy.ErrPresetStale
		}
		refs = preview.Impacts
		version = edit.Version + 1
	}
	var duplicate bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM outbound_configs WHERE name=? AND id!=?)`, c.Name, id).Scan(&duplicate); err != nil {
		return proxy.Outbound{}, err
	}
	if duplicate {
		return proxy.Outbound{}, proxy.ErrConflict
	}
	raw, err := json.Marshal(c)
	if err != nil {
		return proxy.Outbound{}, err
	}
	encrypted, err := s.sealEngine("outbound:"+id, raw)
	if err != nil {
		return proxy.Outbound{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO outbound_configs(id,name,version,config_encrypted,created_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,version=excluded.version,config_encrypted=excluded.config_encrypted`, id, c.Name, version, encrypted, now()); err != nil {
		return proxy.Outbound{}, err
	}
	changes := []realtime.Change{}
	for _, r := range refs {
		if r.DraftOnly {
			continue
		}
		t, e := s.readTarget(ctx, tx, r.EngineID)
		if e != nil {
			return proxy.Outbound{}, e
		}
		before := canonicalCommand(t.Command)
		for i, o := range t.Command.Outbounds {
			if o.ID == id {
				copy := c
				t.Command.Outbounds[i] = wireOutbound(copy)
			}
		}
		if before == canonicalCommand(t.Command) {
			continue
		}
		if err = tx.QueryRowContext(ctx, `SELECT run_intent,version FROM engines WHERE id=?`, t.ID).Scan(&t.Command.RunIntent, &t.Command.Version); err != nil {
			return proxy.Outbound{}, err
		}
		// Preserve a concurrent lifecycle operation's intent and version.
		var active string
		e = tx.QueryRowContext(ctx, `SELECT command_encrypted FROM engine_operations WHERE engine_id=? AND active=1 AND operation NOT IN ('engine.apply','engine.inspect')`, t.ID).Scan(&active)
		if e != nil && !errors.Is(e, sql.ErrNoRows) {
			return proxy.Outbound{}, e
		}
		if e == nil {
			b, e := s.openEngine(t.ID, active)
			if e != nil {
				return proxy.Outbound{}, e
			}
			var cmd v1.EngineCommand
			if e = json.Unmarshal(b, &cmd); e != nil {
				return proxy.Outbound{}, e
			}
			t.Command.RunIntent = cmd.RunIntent
			t.Command.Version = cmd.Version
		}
		if err = tx.QueryRowContext(ctx, `SELECT desired_revision+1 FROM engines WHERE id=?`, t.ID).Scan(&t.Revision); err != nil {
			return proxy.Outbound{}, err
		}
		t.Actor = actor
		t.Error = ""
		if _, err = tx.ExecContext(ctx, `UPDATE tasks SET state='cancelled',updated_at=? WHERE id IN (SELECT task_id FROM engine_operations WHERE engine_id=? AND draft_version=-1) AND state='queued' AND attempt=0`, now(), t.ID); err != nil {
			return proxy.Outbound{}, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE engine_operations SET active=0 WHERE engine_id=? AND task_id IN (SELECT id FROM tasks WHERE state='cancelled')`, t.ID); err != nil {
			return proxy.Outbound{}, err
		}
		if err = s.writeTarget(ctx, tx, t, true); err != nil {
			return proxy.Outbound{}, err
		}
		changes = append(changes, realtime.Change{Kind: "node", NodeID: t.Node}, realtime.Change{Kind: "engines", NodeID: t.Node})
	}
	if err = audit(ctx, tx, actor, "outbound.save", "outbound", id); err != nil {
		return proxy.Outbound{}, err
	}
	if err = s.commitChanges(tx, changes...); err != nil {
		return proxy.Outbound{}, err
	}
	return redactOutbound(proxy.Outbound{ID: id, Config: c, Version: version, References: len(refs)}), nil
}
func (s *Store) DeleteOutbound(ctx context.Context, actor, id string, version int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `UPDATE outbound_configs SET id=id WHERE id=?`, id); err != nil {
		return err
	}
	if err = presetAccess(ctx, tx, actor, true); err != nil {
		return err
	}
	o, err := s.readOutbound(ctx, tx, id)
	if err != nil {
		return err
	}
	if o.Version != version {
		return proxy.ErrPresetStale
	}
	refs, err := s.outboundReferences(ctx, tx, id)
	if err != nil {
		return err
	}
	if len(refs) > 0 {
		return proxy.ErrConflict
	}
	// In-flight commands and last successfully applied configurations also retain references.
	var used bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM engine_operations o JOIN tasks t ON t.id=o.task_id,json_each(o.public_snapshot,'$.routing.outbound_ids') j WHERE j.value=? AND (o.active=1 OR (t.state='succeeded' AND o.operation='engine.apply' AND o.revision=(SELECT max(p.revision) FROM engine_operations p JOIN tasks pt ON pt.id=p.task_id WHERE p.engine_id=o.engine_id AND p.operation='engine.apply' AND pt.state='succeeded'))))`, id).Scan(&used); err != nil {
		return err
	}
	if used {
		return proxy.ErrConflict
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM outbound_configs WHERE id=?`, id); err != nil {
		return err
	}
	if err = audit(ctx, tx, actor, "outbound.delete", "outbound", id); err != nil {
		return err
	}
	return tx.Commit()
}
func (s *Store) resolveOutbounds(ctx context.Context, q engineQuery, d proxy.Draft, c *v1.EngineCommand) error {
	c.Routing = wireRouting(d.Routing)
	c.Outbounds = nil
	if d.Routing == nil {
		return nil
	}
	for _, id := range d.Routing.OutboundIds {
		o, err := s.readOutbound(ctx, q, id)
		if err != nil {
			return err
		}
		c.Outbounds = append(c.Outbounds, wireOutbound(o.Config))
	}
	return nil
}

// Copy creates a separate global configuration without disclosing its credentials.
func (s *Store) CopyOutbound(ctx context.Context, actor, id, name string) (proxy.Outbound, error) {
	if err := presetAccess(ctx, s.db, actor, true); err != nil {
		return proxy.Outbound{}, err
	}
	o, err := s.readOutbound(ctx, s.db, id)
	if err != nil {
		return proxy.Outbound{}, err
	}
	o.Config.Name = name
	return s.SaveOutbound(ctx, actor, "", proxy.OutboundEdit{Config: o.Config})
}
