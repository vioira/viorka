import { describe, expect, it } from 'vitest';
import type { StatusNode } from '@/api/public-status';
import { periodUsage, rentalValue } from './format';

const asset = {
  price: '60',
  months: 1,
  expires: '2026-03-31T00:00:00Z',
  currency: 'EUR',
} as StatusNode;
const rates = {
  day: '2026-03-01',
  quotes: { CNY: { date: '2026-03-01', rate: 7 }, EUR: { date: '2026-03-01', rate: 0.875 } },
};
describe('公开指标口径', () => {
  it('按自然月起止折算剩余租金并换算交叉汇率', () => {
    const middle = (Date.parse(asset.expires ?? '') + Date.parse('2026-02-28T00:00:00Z')) / 2;
    expect(rentalValue(asset, rates, middle)).toBe(240);
    expect(rentalValue(asset, { day: '', quotes: null }, middle)).toBeNull();
    expect(rentalValue({ ...asset, price: '0', expires: null }, rates, middle)).toBe(0);
  });
  it('月账期流量保留精度与未知状态', () => {
    const f = {
      period_end: '2027-01-01T00:00:00Z',
      period_rx: '10',
      period_tx: '9007199254740993',
      billing_mode: 'outbound',
    } as NonNullable<StatusNode['fast']>;
    expect(periodUsage(f, 0)).toBe(9007199254740993n);
    expect(periodUsage({ ...f, billing_mode: 'both' }, 0)).toBe(9007199254741003n);
    expect(periodUsage({ ...f, period_tx: null }, 0)).toBeNull();
    expect(periodUsage(f, Date.parse(f.period_end ?? ''))).toBeNull();
  });
});
