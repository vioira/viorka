import { billingCurrencies, billingPeriods, type NodeBilling } from '@/api/node-billing';
import type { BillingUpdate } from '@/api/node-settings';
import { localDate } from '@/utils/node-assets';

export function editBilling(base: NodeBilling) {
  return {
    base,
    fee: {
      price: base.price ?? '',
      currency: base.currency ?? '',
      period: String(base.period_months ?? ''),
    },
    expiry: base.expires_at ? localDate(new Date(base.expires_at)) : '',
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
  if (draft.expiry !== original.expiry) {
    rebased.expiry = draft.expiry;
  }
  return rebased;
}

export function billingDirty(draft: BillingDraft) {
  const original = editBilling(draft.base);
  return (
    draft.fee.price !== original.fee.price ||
    (!!draft.fee.price &&
      (draft.fee.currency !== original.fee.currency || draft.fee.period !== original.fee.period)) ||
    draft.expiry !== original.expiry
  );
}

export function billingUpdate(draft: BillingDraft): BillingUpdate {
  const { price, currency, period } = draft.fee;
  const update: BillingUpdate = { expected_revision: draft.base.revision };
  if (draft.expiry === editBilling(draft.base).expiry) update.keep_expiry = true;
  else if (draft.expiry) {
    update.expires_on = draft.expiry;
    update.time_zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
  if (!price) return update;
  if (
    !billingCurrencies.includes(currency as NonNullable<NodeBilling['currency']>) ||
    !Object.hasOwn(billingPeriods, period)
  )
    throw new Error('填写价格时，请选择货币和计费周期。');
  if (!(currency === 'JPY' ? /^\d{1,19}$/ : /^\d{1,19}(\.\d{1,2})?$/).test(price))
    throw new Error(
      currency === 'JPY' ? '日元价格须为非负整数。' : '请输入非负价格，最多保留两位小数。',
    );
  return {
    ...update,
    price,
    currency: currency as NodeBilling['currency'],
    period_months: Number(period) as NodeBilling['period_months'],
  };
}
