import { afterEach, expect, it, vi } from 'vitest';
import type { NodeBilling } from '@/api/node-billing';
import { billingUpdate, editBilling, rebaseBillingDraft } from './node-billing-draft';

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
  draft.expiry = '';
  const latest: NodeBilling = { ...billing, revision: 2, price: '99' };
  expect(rebaseBillingDraft(draft, latest)).toEqual({
    base: latest,
    fee: { price: '99', currency: 'USD', period: '3' },
    expiry: '',
  });
});

it('preserves legacy instants on fee edits and sends dates with the browser zone', () => {
  vi.stubEnv('TZ', 'America/New_York');
  const draft = editBilling(billing);
  expect(draft.expiry).toBe('2026-11-01');
  expect(billingUpdate(draft)).toMatchObject({ keep_expiry: true });
  draft.expiry = '2026-11-02';
  expect(billingUpdate(draft)).toMatchObject({
    expires_on: '2026-11-02',
    time_zone: 'America/New_York',
  });
  draft.expiry = '';
  const cleared = billingUpdate(draft);
  expect(cleared).not.toHaveProperty('keep_expiry');
  expect(cleared).not.toHaveProperty('expires_on');
});
