package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/vioira/viorka/internal/proxy"
	v1 "github.com/vioira/viorka/protocol/v1"
)

// Preserve published endpoint metadata that is intentionally not sent to the
// runtime. A matching effective command is required before exposing it again.
func (s *Store) archiveEngineMetadata(ctx context.Context, tx *sql.Tx, node string) error {
	rows, err := tx.QueryContext(ctx, `SELECT id,observed_revision FROM engines WHERE node_id=?`, node)
	if err != nil {
		return err
	}
	type observed struct {
		id       string
		revision int64
	}
	var items []observed
	for rows.Next() {
		var item observed
		if err = rows.Scan(&item.id, &item.revision); err != nil {
			break
		}
		items = append(items, item)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return err
	}
	for _, item := range items {
		var command, snapshot string
		// Endpoint-only publications update the confirmed target without writing
		// an apply operation. Start/stop may also advance its revision.
		err = tx.QueryRowContext(ctx, `SELECT command_encrypted,public_snapshot FROM engine_targets WHERE engine_id=? AND sync_error='' AND revision<=?`, item.id, item.revision).Scan(&command, &snapshot)
		if errors.Is(err, sql.ErrNoRows) {
			err = tx.QueryRowContext(ctx, `SELECT o.command_encrypted,o.public_snapshot FROM engine_operations o JOIN tasks k ON k.id=o.task_id WHERE o.engine_id=? AND o.operation='engine.apply' AND `+currentInstallationOperation+` AND k.state='succeeded' ORDER BY o.revision DESC LIMIT 1`, item.id).Scan(&command, &snapshot)
			if errors.Is(err, sql.ErrNoRows) {
				continue
			}
		}
		if err != nil {
			return err
		}
		raw, err := s.openEngine(item.id, command)
		if err != nil {
			return err
		}
		var c v1.EngineCommand
		if err = json.Unmarshal(raw, &c); err != nil {
			return err
		}
		sealed, err := s.sealEngine(item.id, []byte(snapshot))
		if err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO engine_recovery_metadata VALUES(?,?,?) ON CONFLICT(engine_id) DO UPDATE SET command_digest=excluded.command_digest,snapshot_encrypted=excluded.snapshot_encrypted`, item.id, v1.EndpointCommandDigest(c), sealed); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) restoreEngineMetadata(ctx context.Context, tx *sql.Tx, id string, c v1.EngineCommand, d *proxy.Draft) error {
	var sealed string
	err := tx.QueryRowContext(ctx, `SELECT snapshot_encrypted FROM engine_recovery_metadata WHERE engine_id=? AND command_digest=?`, id, v1.EndpointCommandDigest(c)).Scan(&sealed)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	raw, err := s.openEngine(id, sealed)
	if err != nil {
		return err
	}
	var old proxy.Draft
	if err = json.Unmarshal(raw, &old); err != nil {
		return err
	}
	for i := range d.Services {
		for _, service := range old.Services {
			if service.ID == d.Services[i].ID {
				d.Services[i].PublicHost = service.PublicHost
				d.Services[i].PublicPort = service.PublicPort
				break
			}
		}
	}
	_, err = tx.ExecContext(ctx, `DELETE FROM engine_recovery_metadata WHERE engine_id=?`, id)
	return err
}
