package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/inventory"
	v1 "github.com/vioira/viorka/protocol/v1"
	"time"
)

func (s *Store) Nodes(ctx context.Context, limit int, after string) ([]inventory.Node, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,name,kind,state,coalesce(last_seen_at,''),coalesce(os,''),coalesce(arch,''),coalesce(agent_version,''),coalesce(inventory_json,'') FROM nodes WHERE id>? ORDER BY id LIMIT ?`, after, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []inventory.Node{}
	for rows.Next() {
		var n inventory.Node
		var raw string
		if err = rows.Scan(&n.ID, &n.Name, &n.Kind, &n.State, &n.LastSeenAt, &n.OS, &n.Arch, &n.AgentVersion, &raw); err != nil {
			return nil, err
		}
		if raw != "" {
			if err = json.Unmarshal([]byte(raw), &n.Inventory); err != nil {
				return nil, err
			}
		}
		items = append(items, n)
	}
	return items, rows.Err()
}
func (s *Store) Online(ctx context.Context, node string, h v1.Hello) error {
	r, err := s.db.ExecContext(ctx, `UPDATE nodes SET state='online',last_seen_at=?,os=?,arch=?,agent_version=? WHERE id=? AND state!='disabled'`, now(), h.OS, h.Arch, h.AgentVersion, node)
	if err != nil {
		return err
	}
	n, _ := r.RowsAffected()
	if n != 1 {
		return auth.ErrUnauthorized
	}
	return nil
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
	return nil
}
func (s *Store) Offline(ctx context.Context, node string) error {
	return s.NotifyOffline(ctx, node)
}
func (s *Store) Recover(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `UPDATE nodes SET state='offline' WHERE state='online'`)
	return err
}

func (s *Store) Node(ctx context.Context, id string) (inventory.Node, error) {
	var n inventory.Node
	var raw string
	err := s.db.QueryRowContext(ctx, `SELECT id,name,kind,state,coalesce(last_seen_at,''),coalesce(os,''),coalesce(arch,''),coalesce(agent_version,''),coalesce(inventory_json,'') FROM nodes WHERE id=?`, id).Scan(&n.ID, &n.Name, &n.Kind, &n.State, &n.LastSeenAt, &n.OS, &n.Arch, &n.AgentVersion, &raw)
	if err == nil && raw != "" {
		err = json.Unmarshal([]byte(raw), &n.Inventory)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return n, auth.ErrNotFound
	}
	return n, err
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
	result, err := s.db.ExecContext(ctx, `UPDATE nodes SET inventory_json=json_set(?,'$.sampled_at',?) WHERE id=? AND state='online' AND (inventory_json IS NULL OR json_extract(inventory_json,'$.sampled_at')<?)`, string(b), at(v.SampledAt), node, at(v.SampledAt))
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
	return nil
}
