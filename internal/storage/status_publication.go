package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/inventory"
	"github.com/vioira/viorka/internal/realtime"
	v1 "github.com/vioira/viorka/protocol/v1"
	"math/big"
	"time"
)

func (s *Store) StatusVersion(ctx context.Context) (revision, categories int64, enabled bool, err error) {
	err = s.db.QueryRowContext(ctx, "SELECT revision,category_revision,enabled FROM status_publication WHERE id=1").Scan(&revision, &categories, &enabled)
	return
}
func (s *Store) StatusPublication(ctx context.Context) (inventory.StatusPublication, error) {
	p := inventory.StatusPublication{Nodes: []inventory.PublishedNode{}}
	// Read the revision and all its members in the same statement.
	rows, err := s.db.QueryContext(ctx, `SELECT p.revision,p.enabled,n.node_id,n.alias FROM status_publication p LEFT JOIN status_nodes n ON 1=1 WHERE p.id=1 ORDER BY n.position`)
	if err != nil {
		return p, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, alias sql.NullString
		if err = rows.Scan(&p.Revision, &p.Enabled, &id, &alias); err != nil {
			return p, err
		}
		if id.Valid {
			p.Nodes = append(p.Nodes, inventory.PublishedNode{ID: id.String, Alias: alias.String})
		}
	}
	return p, rows.Err()
}
func (s *Store) SaveStatusPublication(ctx context.Context, actor string, p inventory.StatusPublication) error {
	if err := p.Validate(); err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, "UPDATE status_publication SET enabled=?,revision=revision+1 WHERE id=1 AND revision=?", p.Enabled, p.Revision)
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
	if _, err = tx.ExecContext(ctx, "DELETE FROM status_nodes"); err != nil {
		return err
	}
	for i, node := range p.Nodes {
		result, err = tx.ExecContext(ctx, `INSERT INTO status_nodes(node_id,alias,position) SELECT id,?,? FROM nodes WHERE id=?`, node.Alias, i, node.ID)
		if err != nil {
			return err
		}
		n, err = result.RowsAffected()
		if err != nil {
			return err
		}
		if n != 1 {
			return auth.ErrNotFound
		}
	}
	if err = audit(ctx, tx, actor, "status.publish", "settings", "public_status"); err != nil {
		return err
	}
	return s.commitChanges(tx, realtime.Change{Kind: "public_status"})
}
func (s *Store) StatusLifetime(ctx context.Context, node string, now time.Time) (*inventory.TrafficLifetime, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT d.day_start,d.day_end,d.rx_bytes,d.tx_bytes,d.quality,d.sampled_at FROM node_daily_traffic d WHERE d.node_id=? AND `+latestDailyTraffic+` ORDER BY d.day_start`, node)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var rx, tx, part big.Int
	var out *inventory.TrafficLifetime
	var lastEnd, lastSample int64
	for rows.Next() {
		var start, end, in, eg, quality, sample int64
		if err = rows.Scan(&start, &end, &in, &eg, &quality, &sample); err != nil {
			return nil, err
		}
		if out == nil {
			out = &inventory.TrafficLifetime{Start: time.UnixMilli(start).UTC()}
		}
		out.Partial = out.Partial || uint64(quality)&v1.DailyTrafficHistoryGap != 0 || (lastEnd != 0 && lastEnd != start)
		lastEnd, lastSample = end, sample
		rx.Add(&rx, part.SetInt64(in))
		tx.Add(&tx, part.SetInt64(eg))
	}
	if out != nil {
		out.RX, out.TX = rx.String(), tx.String()
		out.Partial = out.Partial || lastEnd <= now.UnixMilli() || now.Sub(time.UnixMilli(lastSample)) > 5*time.Minute
	}
	return out, rows.Err()
}
func (s *Store) StatusRates(ctx context.Context) (inventory.ExchangeRates, error) {
	var r inventory.ExchangeRates
	var raw string
	err := s.db.QueryRowContext(ctx, "SELECT fetched_day,quotes FROM status_exchange_rates WHERE id=1").Scan(&r.Day, &raw)
	if errors.Is(err, sql.ErrNoRows) {
		return r, nil
	}
	if err == nil {
		err = json.Unmarshal([]byte(raw), &r.Quotes)
	}
	return r, err
}
func (s *Store) SaveStatusRates(ctx context.Context, r inventory.ExchangeRates) error {
	raw, err := json.Marshal(r.Quotes)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO status_exchange_rates(id,fetched_day,quotes) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET fetched_day=excluded.fetched_day,quotes=excluded.quotes WHERE status_exchange_rates.fetched_day<=excluded.fetched_day`, r.Day, string(raw))
	return err
}
