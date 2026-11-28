package storage

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/inventory"
)

func (s *Store) SaveNodeBilling(ctx context.Context, actor, node string, update inventory.BillingUpdate) (inventory.Billing, error) {
	result, err := s.SaveNodeSettings(ctx, actor, node, nil, &update, nil)
	if err != nil {
		return inventory.Billing{}, err
	}
	return *result.Billing, nil
}

func saveNodeBillingTx(ctx context.Context, tx *sql.Tx, actor, node string, update inventory.BillingUpdate) (inventory.Billing, error) {
	var b inventory.Billing
	minor, err := update.MinorUnits()
	if err != nil {
		return b, err
	}
	b.Currency = update.Currency
	b.PeriodMonths = update.PeriodMonths
	b.SetMinorUnits(minor)
	expiry, err := update.ExpiryInstant()
	if err != nil {
		return b, err
	}
	if expiry != nil {
		utc := expiry.UTC().Format(time.RFC3339)
		b.ExpiresAt = &utc
	}
	err = tx.QueryRowContext(ctx, `UPDATE nodes SET price_minor=?,currency=NULLIF(?,''),period_months=?,
 rental_expires_at=CASE WHEN ?=1 THEN rental_expires_at ELSE ? END,billing_revision=billing_revision+1 WHERE id=? AND billing_revision=?
 RETURNING billing_revision,rental_expires_at`, minor, b.Currency, b.PeriodMonths, update.KeepExpiry, b.ExpiresAt, node, update.ExpectedRevision).Scan(&b.Revision, &b.ExpiresAt)
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
	return b, nil
}
