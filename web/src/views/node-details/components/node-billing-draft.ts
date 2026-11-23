import type { NodeBilling } from '@/api/node-billing';
import { localMinute } from '@/utils/node-assets';

export function editBilling(base: NodeBilling) {
  return {
    base,
    fee: {
      price: base.price ?? '',
      currency: base.currency ?? '',
      period: String(base.period_months ?? ''),
    },
    expiry: {
      minute: localMinute(base.expires_at),
      instant: base.expires_at ? new Date(base.expires_at).toISOString() : undefined,
    },
  };
}

export type BillingDraft = ReturnType<typeof editBilling>;

// The amount, currency and period describe one price and must move together.
export function rebaseBillingDraft(draft: BillingDraft, latest: NodeBilling): BillingDraft {
  const original = editBilling(draft.base);
  const rebased = editBilling(latest);
  const { price, currency, period } = draft.fee;
  if (
    price !== original.fee.price ||
    (price && (currency !== original.fee.currency || period !== original.fee.period))
  ) {
    rebased.fee = draft.fee;
  }
  if (
    draft.expiry.minute !== original.expiry.minute ||
    draft.expiry.instant !== original.expiry.instant
  ) {
    rebased.expiry = draft.expiry;
  }
  return rebased;
}
