package storage

import (
	"context"
	"database/sql"
	"strings"
	"time"

	"github.com/vioira/viorka/internal/alerts"
)

func offlineRulesDue(ctx context.Context, tx *sql.Tx, now time.Time) (bool, error) {
	cfg, e := readAlertConfig(ctx, tx)
	if e != nil {
		return false, e
	}
	changed := false
	remaining := 100
	for _, r := range cfg.Rules {
		if remaining == 0 {
			break
		}
		if !r.Enabled || r.Metric != "offline" {
			continue
		}
		col := "n.outage_since"
		if r.ID == alerts.Builtin {
			col = "n.offline_alert_since"
		}
		query := "SELECT n.id,n.name," + col + " FROM nodes n LEFT JOIN alert_states s ON s.node_id=n.id AND s.rule_id=? WHERE n.state='offline' AND " + col + "<=? AND (coalesce(s.started_ms,0)=0 OR (? > 0 AND s.last_sent_ms<=?))"
		args := []any{r.ID, at(now.Add(-time.Duration(r.WindowMinutes) * time.Minute)), r.RepeatMinutes, now.Add(-time.Duration(r.RepeatMinutes) * time.Minute).UnixMilli()}
		if len(r.Nodes) > 0 {
			query += " AND n.id IN (" + strings.TrimSuffix(strings.Repeat("?,", len(r.Nodes)), ",") + ")"
			for _, id := range r.Nodes {
				args = append(args, id)
			}
		}
		args = append(args, remaining)
		rows, e := tx.QueryContext(ctx, query+" ORDER BY "+col+",n.id LIMIT ?", args...)
		if e != nil {
			return false, e
		}
		type item struct{ id, name, since string }
		var items []item
		for rows.Next() {
			var n item
			if e = rows.Scan(&n.id, &n.name, &n.since); e != nil {
				rows.Close()
				return false, e
			}
			items = append(items, n)
		}
		if e = rows.Err(); e != nil {
			rows.Close()
			return false, e
		}
		rows.Close()
		remaining -= len(items)
		for _, n := range items {
			start, e := time.Parse(time.RFC3339Nano, n.since)
			if e != nil {
				return false, e
			}
			sent, e := applyAlert(ctx, tx, cfg, n.id, n.name, alerts.Decision{Rule: r, At: now, High: true, Value: now.Sub(start).Minutes()}, now)
			if e != nil {
				return false, e
			}
			changed = changed || sent
		}
	}
	return changed, nil
}
func recoverOfflineRules(ctx context.Context, tx *sql.Tx, node string, now time.Time) (bool, error) {
	cfg, e := readAlertConfig(ctx, tx)
	if e != nil {
		return false, e
	}
	changed := false
	for _, r := range cfg.Rules {
		if r.Metric != "offline" || !r.Applies(node) {
			continue
		}
		var name string
		var last int64
		e := tx.QueryRowContext(ctx, "SELECT n.name,s.evaluated_ms FROM alert_states s JOIN nodes n ON n.id=s.node_id WHERE s.rule_id=? AND s.node_id=? AND s.started_ms>0", r.ID, node).Scan(&name, &last)
		if e == sql.ErrNoRows {
			continue
		}
		if e != nil {
			return false, e
		}
		sample := now
		if sample.UnixMilli() <= last {
			sample = time.UnixMilli(last + 1)
		}
		sent, e := applyAlert(ctx, tx, cfg, node, name, alerts.Decision{Rule: r, At: sample, Normal: true}, now)
		if e != nil {
			return false, e
		}
		changed = changed || sent
		if _, e = tx.ExecContext(ctx, "DELETE FROM alert_states WHERE rule_id=? AND node_id=?", r.ID, node); e != nil {
			return false, e
		}
	}
	return changed, nil
}
