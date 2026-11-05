package storage

import (
	"context"
	"database/sql"
	"errors"

	"github.com/vioira/viorka/internal/inventory"
	"github.com/vioira/viorka/internal/monitoring"
	"github.com/vioira/viorka/internal/realtime"
)

func selectedLocationIP(ctx context.Context, tx *sql.Tx, node string) (string, error) {
	var v4, v6 string
	err := tx.QueryRowContext(ctx, `SELECT coalesce((SELECT address FROM node_public_addresses WHERE node_id=? AND family=4),''),coalesce((SELECT address FROM node_public_addresses WHERE node_id=? AND family=6),'')`, node, node).Scan(&v4, &v6)
	return inventory.LocationIP(v4, v6), err
}

// Both inventory and telemetry share per-family sampling order and invalidation.
func savePublicAddresses(ctx context.Context, tx *sql.Tx, node string, addresses []monitoring.AddressSnapshot) (bool, error) {
	if len(addresses) == 0 {
		return false, nil
	}
	before, err := selectedLocationIP(ctx, tx, node)
	if err != nil {
		return false, err
	}
	for _, v := range addresses {
		_, err = tx.ExecContext(ctx, `INSERT INTO node_public_addresses VALUES(?,?,?,?,?) ON CONFLICT(node_id,family) DO UPDATE SET address=excluded.address,sampled_at=excluded.sampled_at,unavailable=excluded.unavailable WHERE excluded.sampled_at>node_public_addresses.sampled_at`, node, v.Family, v.Address, v.SampledAt, v.Unavailable)
		if err != nil {
			return false, err
		}
	}
	after, err := selectedLocationIP(ctx, tx, node)
	if err != nil {
		return false, err
	}
	if before != after {
		_, err = tx.ExecContext(ctx, `UPDATE nodes SET geo_country_code='',geo_subdivision='',geo_city='' WHERE id=?`, node)
	}
	return before != after, err
}

func (s *Store) LocationCandidates(ctx context.Context, after string, limit int) ([]inventory.LocationCandidate, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT n.id,coalesce(v4.address,''),coalesce(v6.address,''),n.geo_country_code,n.geo_subdivision,n.geo_city FROM nodes n LEFT JOIN node_public_addresses v4 ON v4.node_id=n.id AND v4.family=4 LEFT JOIN node_public_addresses v6 ON v6.node_id=n.id AND v6.family=6 WHERE n.id>? ORDER BY n.id LIMIT ?`, after, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []inventory.LocationCandidate{}
	for rows.Next() {
		var c inventory.LocationCandidate
		var v4, v6 string
		if err = rows.Scan(&c.ID, &v4, &v6, &c.Location.CountryCode, &c.Location.Subdivision, &c.Location.City); err != nil {
			return nil, err
		}
		c.IP = inventory.LocationIP(v4, v6)
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) SaveLocation(ctx context.Context, node, ip string, location inventory.Location) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Acquire SQLite's writer lock before comparing the address.
	result, err := tx.ExecContext(ctx, `UPDATE nodes SET id=id WHERE id=?`, node)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil || count == 0 {
		return err
	}
	current, err := selectedLocationIP(ctx, tx, node)
	if err != nil {
		return err
	}
	if current != ip {
		return nil
	}
	if ip == "" {
		location = inventory.Location{}
	}
	var old inventory.Location
	err = tx.QueryRowContext(ctx, `SELECT geo_country_code,geo_subdivision,geo_city FROM nodes WHERE id=?`, node).Scan(&old.CountryCode, &old.Subdivision, &old.City)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if old == location {
		return nil
	}
	_, err = tx.ExecContext(ctx, `UPDATE nodes SET geo_country_code=?,geo_subdivision=?,geo_city=? WHERE id=?`, location.CountryCode, location.Subdivision, location.City, node)
	if err != nil {
		return err
	}
	return s.commitChanges(tx, realtime.Change{Kind: "node", NodeID: node})
}
