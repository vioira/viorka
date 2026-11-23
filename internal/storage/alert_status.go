package storage

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/vioira/viorka/internal/alerts"
	"github.com/vioira/viorka/internal/auth"
)

type alertReadingCache struct {
	sync.Mutex
	entries   map[string]map[string]alerts.Reading
	lastSweep time.Time
}

func (s *Store) recordAlertReadings(node string, entries map[string]alerts.Reading, now time.Time) {
	c := &s.alertReadings
	c.Lock()
	defer c.Unlock()
	if c.entries == nil {
		c.entries = map[string]map[string]alerts.Reading{}
	}
	if now.Sub(c.lastSweep) >= time.Minute {
		for n, list := range c.entries {
			for k, v := range list {
				if v.ExpiresMS < now.UnixMilli() {
					delete(list, k)
				}
			}
			if len(list) == 0 {
				delete(c.entries, n)
			}
		}
		c.lastSweep = now
	}
	if len(entries) == 0 {
		return
	}
	if c.entries[node] == nil {
		c.entries[node] = map[string]alerts.Reading{}
	}
	for k, v := range entries {
		if old := c.entries[node][k]; v.SampleMS >= old.SampleMS {
			c.entries[node][k] = v
		}
	}
}
func (s *Store) AlertRuleStatus(ctx context.Context, id, after string) (alerts.StatusPage, error) {
	out := alerts.StatusPage{Items: []alerts.NodeStatus{}}
	if len(after) > 128 {
		return out, auth.ErrInvalid
	}
	tx, e := s.db.BeginTx(ctx, nil)
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	cfg, e := readAlertConfig(ctx, tx)
	if e != nil {
		return out, e
	}
	var rule alerts.Rule
	for _, r := range cfg.Rules {
		if r.ID == id {
			rule = r
			break
		}
	}
	if rule.ID == "" {
		return out, auth.ErrNotFound
	}
	query := `SELECT n.id,n.name,n.state,coalesce(n.outage_since,''),coalesce(s.started_ms,0) FROM nodes n LEFT JOIN alert_states s ON s.node_id=n.id AND s.rule_id=? WHERE n.id>?`
	args := []any{id, after}
	if len(rule.Nodes) > 0 {
		query += " AND n.id IN (" + strings.TrimSuffix(strings.Repeat("?,", len(rule.Nodes)), ",") + ")"
		for _, node := range rule.Nodes {
			args = append(args, node)
		}
	}
	rows, e := tx.QueryContext(ctx, query+" ORDER BY n.id LIMIT 51", args...)
	if e != nil {
		return out, e
	}
	defer rows.Close()
	s.alertReadings.Lock()
	defer s.alertReadings.Unlock()
	now := time.Now().UnixMilli()
	for rows.Next() {
		var item alerts.NodeStatus
		var state, since string
		var started int64
		if e = rows.Scan(&item.ID, &item.Name, &state, &since, &started); e != nil {
			return out, e
		}
		if len(out.Items) == 50 {
			out.Next = out.Items[49].ID
			break
		}
		item.Active = started > 0
		item.State = "insufficient"
		switch {
		case !rule.Enabled:
			item.State = "disabled"
		case rule.Metric == "offline":
			if state == "online" {
				item.State = "normal"
			} else if state == "offline" && since != "" {
				item.State = "waiting"
				if item.Active {
					item.State = "high"
				}
			}
		default:
			v, ok := s.alertReadings.entries[item.ID][rule.ID]
			if ok && v.Since == rule.Since && v.ExpiresMS >= now {
				item.State = v.State
			}
		}
		out.Items = append(out.Items, item)
	}
	return out, rows.Err()
}
