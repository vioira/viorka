package storage

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/inventory"
	"github.com/vioira/viorka/internal/realtime"
)

func (s *Store) SaveNodeBilling(ctx context.Context, actor, node string, update inventory.BillingUpdate) (inventory.Billing, error) {
	var b inventory.Billing
	minor, err := update.MinorUnits()
	if err != nil {
		return b, err
	}
	b.Currency = update.Currency
	b.PeriodMonths = update.PeriodMonths
	b.SetMinorUnits(minor)
	if update.ExpiresAt != nil {
		utc := update.ExpiresAt.UTC().Format(time.RFC3339)
		b.ExpiresAt = &utc
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return b, err
	}
	defer tx.Rollback()
	err = tx.QueryRowContext(ctx, `UPDATE nodes SET price_minor=?,currency=NULLIF(?,''),period_months=?,
 rental_expires_at=?,billing_revision=billing_revision+1 WHERE id=? AND billing_revision=?
 RETURNING billing_revision`, minor, b.Currency, b.PeriodMonths, b.ExpiresAt, node, update.ExpectedRevision).Scan(&b.Revision)
	if errors.Is(err, sql.ErrNoRows) {
		var exists bool
		if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM nodes WHERE id=?)`, node).Scan(&exists); err != nil {
			return b, err
		}
		if !exists {
			return b, auth.ErrNotFound
		}
		return b, auth.ErrConflict
	}
	if err != nil {
		return b, err
	}
	if err = audit(ctx, tx, actor, "node.billing.update", "node", node); err != nil {
		return b, err
	}
	return b, s.commitChanges(tx, realtime.Change{Kind: "node", NodeID: node})
}
