package storage

import (
	"context"
	"database/sql"
	"errors"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/inventory"
	"github.com/vioira/viorka/internal/realtime"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func (s *Store) SaveNodeSettings(ctx context.Context, actor, node string, domain *inventory.DomainUpdate, billing *inventory.BillingUpdate, telemetry *v1.TelemetrySettings) (inventory.NodeSettingsResult, error) {
	var result inventory.NodeSettingsResult
	if domain == nil && billing == nil && telemetry == nil {
		return result, auth.ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	var changes []realtime.Change
	if domain != nil {
		r, err := tx.ExecContext(ctx, `UPDATE nodes SET domain=? WHERE id=? AND domain=?`, domain.Value, node, domain.Expected)
		if err != nil {
			return result, err
		}
		count, err := r.RowsAffected()
		if err != nil {
			return result, err
		}
		if count == 0 {
			var current string
			err := tx.QueryRowContext(ctx, `SELECT domain FROM nodes WHERE id=?`, node).Scan(&current)
			if errors.Is(err, sql.ErrNoRows) {
				return result, auth.ErrNotFound
			}
			if err != nil {
				return result, err
			}
			if current != domain.Value {
				return result, auth.ErrConflict
			}
		} else if domain.Value != domain.Expected {
			if err := audit(ctx, tx, actor, "node.domain.update", "node", node); err != nil {
				return result, err
			}
			changes = append(changes, realtime.Change{Kind: "node", NodeID: node})
		}
		result.Domain = &domain.Value
	}
	if billing != nil {
		saved, err := saveNodeBillingTx(ctx, tx, actor, node, *billing)
		if err != nil {
			return inventory.NodeSettingsResult{}, err
		}
		result.Billing = &saved
		changes = append(changes, realtime.Change{Kind: "node", NodeID: node})
	}
	if telemetry != nil {
		saved, err := saveTelemetrySettingsTx(ctx, tx, actor, node, *telemetry)
		if err != nil {
			return inventory.NodeSettingsResult{}, err
		}
		result.Telemetry = &saved
		changes = append(changes, realtime.Change{Kind: "telemetry_settings", NodeID: node, Revision: saved.Revision})
	}
	if err := s.commitChanges(tx, changes...); err != nil {
		return inventory.NodeSettingsResult{}, err
	}
	return result, nil
}
