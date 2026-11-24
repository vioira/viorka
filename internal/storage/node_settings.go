package storage

import (
	"context"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/inventory"
	"github.com/vioira/viorka/internal/realtime"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func (s *Store) SaveNodeSettings(ctx context.Context, actor, node string, billing *inventory.BillingUpdate, telemetry *v1.TelemetrySettings) (inventory.NodeSettingsResult, error) {
	var result inventory.NodeSettingsResult
	if billing == nil && telemetry == nil {
		return result, auth.ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	var changes []realtime.Change
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
