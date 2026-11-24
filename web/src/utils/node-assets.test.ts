import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NodeRecord } from '@/api/nodes';
import { localDate, nodeCost, nodeExpiry, nodeUptime } from './node-assets';

describe('node rental and host observations', () => {
  const time = '2026-11-20T03:04:00Z';
  const now = Date.parse(time);
  const host = { state: 'online', uptime_seconds: 1047600, uptime_sampled_at: time } as NodeRecord;
  it('keeps the measured duration through offline and stale states', () => {
    expect(nodeUptime(host, now + 600000)).toBe('12 天 3 小时');
    expect(nodeUptime(host, now + 900000)).toContain('上次采样');
    expect(nodeUptime({ ...host, state: 'offline' }, now)).toContain('上次采样');
    expect(nodeUptime({ ...host, uptime_seconds: undefined }, now)).toBe('暂无数据');
    expect(nodeUptime({ ...host, uptime_seconds: 0 }, now)).toBe('0 秒');
  });
  it('preserves zero price, independent expiry and its expiry status', () => {
    expect(nodeCost({ revision: 1 })).toBe('免费');
    expect(nodeCost({ revision: 1, price: '0', currency: 'JPY', period_months: 60 })).toBe(
      '0 JPY / 五年',
    );
    expect(nodeCost({ revision: 2, price: '240', currency: 'CNY', period_months: 24 })).toBe(
      '240 CNY / 两年',
    );
    expect(nodeExpiry(undefined, now)).toBe('尚未读取');
    expect(nodeExpiry({ revision: 1 }, now)).toBe('永不过期');
    expect(nodeExpiry({ revision: 1, expires_at: time }, now)).toContain('已到期');
  });
});

describe('local expiry date', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('shows the calendar day in the browser zone across UTC midnight', () => {
    vi.stubEnv('TZ', 'America/New_York');
    expect(localDate(new Date('2026-11-02T04:59:59Z'))).toBe('2026-11-01');
  });
});
