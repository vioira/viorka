import { afterEach, expect, it, vi } from 'vitest';
import type { NodeBilling } from '@/api/node-billing';
import { editBilling, rebaseBillingDraft } from './node-billing-draft';

const billing: NodeBilling = {
  revision: 1,
  price: '12.50',
  currency: 'USD',
  period_months: 3,
  expires_at: '2026-11-01T06:30:00Z',
};

afterEach(() => vi.unstubAllEnvs());

it('keeps the edited fee together and adopts the latest unedited expiry', () => {
  const draft = editBilling(billing);
  draft.fee.price = '0';
  const latest: NodeBilling = {
    revision: 2,
    price: '1000',
    currency: 'JPY',
    period_months: 1,
    expires_at: '2027-01-01T00:00:00Z',
  };
  expect(rebaseBillingDraft(draft, latest)).toEqual({
    base: latest,
    fee: { price: '0', currency: 'USD', period: '3' },
    expiry: editBilling(latest).expiry,
  });
});

it('keeps an explicitly cleared expiry while bringing in the latest fee', () => {
  const draft = editBilling(billing);
  draft.expiry = { minute: '', instant: undefined };
  const latest: NodeBilling = { ...billing, revision: 2, price: '99' };
  expect(rebaseBillingDraft(draft, latest)).toEqual({
    base: latest,
    fee: { price: '99', currency: 'USD', period: '3' },
    expiry: { minute: '', instant: undefined },
  });
});

it('preserves an edit to the UTC instant even if the local minute is unchanged', () => {
  vi.stubEnv('TZ', 'America/New_York');
  const draft = editBilling(billing);
  draft.expiry.instant = '2026-11-01T05:30:00.000Z';
  expect(draft.expiry.minute).toBe('2026-11-01T01:30');
  expect(editBilling({ ...billing, expires_at: draft.expiry.instant }).expiry.minute).toBe(
    draft.expiry.minute,
  );
  const latest: NodeBilling = { ...billing, revision: 2, expires_at: undefined };
  expect(rebaseBillingDraft(draft, latest).expiry).toEqual(draft.expiry);
});
