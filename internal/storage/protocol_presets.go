package storage

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/proxy"
)

func presetAccess(ctx context.Context, q engineQuery, actor string, write bool) error {
	var role string
	var disabled bool
	err := q.QueryRowContext(ctx, `SELECT role,disabled FROM users WHERE id=?`, actor).Scan(&role, &disabled)
	if errors.Is(err, sql.ErrNoRows) {
		return proxy.ErrForbidden
	}
	if err != nil {
		return err
	}
	if disabled || write && role != "admin" && role != "operator" {
		return proxy.ErrForbidden
	}
	return nil
}
func scanPreset(row interface{ Scan(...any) error }) (proxy.Preset, error) {
	var p proxy.Preset
	var raw string
	err := row.Scan(&p.ID, &raw, &p.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return p, auth.ErrNotFound
	}
	if err != nil {
		return p, err
	}
	err = json.Unmarshal([]byte(raw), &p.Config)
	p.Referenceable = proxy.PresetReferenceable(p.Config)
	p.ReferenceIssues = proxy.PresetReferenceIssues(p.Config)
	return p, err
}
func (s *Store) ProtocolPresets(ctx context.Context, actor, after string, limit int) ([]proxy.Preset, error) {
	if err := presetAccess(ctx, s.db, actor, false); err != nil {
		return nil, err
	}
	if limit < 1 || limit > 100 || len(after) > 128 {
		return nil, proxy.ErrInvalid
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id,config_json,created_at FROM protocol_presets WHERE id>? ORDER BY id LIMIT ?`, after, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []proxy.Preset{}
	for rows.Next() {
		p, e := scanPreset(rows)
		if e != nil {
			return nil, e
		}
		items = append(items, p)
	}
	return items, rows.Err()
}
func (s *Store) CreateProtocolPreset(ctx context.Context, actor string, c proxy.PresetConfig) (proxy.Preset, error) {
	if err := proxy.ValidatePreset(c); err != nil {
		return proxy.Preset{}, err
	}
	if c.ShortIDs == nil {
		c.ShortIDs = []string{}
	}
	if c.Security == "reality" && len(c.ShortIDs) == 0 {
		var random [16]byte
		if _, err := rand.Read(random[:]); err != nil {
			return proxy.Preset{}, err
		}
		c.ShortIDs = []string{hex.EncodeToString(random[:8]), hex.EncodeToString(random[8:])}
		if err := proxy.ValidatePreset(c); err != nil {
			return proxy.Preset{}, err
		}
	}
	p := proxy.Preset{ID: auth.Random(), Config: c, CreatedAt: now(), Referenceable: proxy.PresetReferenceable(c), ReferenceIssues: proxy.PresetReferenceIssues(c)}
	raw, err := json.Marshal(c)
	if err != nil {
		return p, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return p, err
	}
	defer tx.Rollback()
	if err = presetAccess(ctx, tx, actor, true); err != nil {
		return p, err
	}
	result, err := tx.ExecContext(ctx, `INSERT INTO protocol_presets(id,name,protocol,config_json,created_at) VALUES(?,?,?,?,?) ON CONFLICT(name) DO NOTHING`, p.ID, c.Name, c.Protocol, string(raw), p.CreatedAt)
	if err != nil {
		return p, err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return p, err
	}
	if n != 1 {
		return p, proxy.ErrConflict
	}
	if err = audit(ctx, tx, actor, "protocol_preset.create", "protocol_preset", p.ID); err != nil {
		return p, err
	}
	return p, tx.Commit()
}
