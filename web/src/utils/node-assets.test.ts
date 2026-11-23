import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NodeRecord } from '@/api/nodes';
import { localMinute, localMinuteOptions, nodeCost, nodeExpiry, nodeUptime } from './node-assets';

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
  it('preserves zero price, independent expiry and the local minute', () => {
    expect(nodeCost({ revision: 1 })).toBe('未设置');
    expect(nodeCost({ revision: 1, price: '0', currency: 'JPY', period_months: 60 })).toBe(
      '0 JPY / 五年',
    );
    expect(nodeCost({ revision: 2, price: '240', currency: 'CNY', period_months: 24 })).toBe(
      '240 CNY / 两年',
    );
    expect(nodeExpiry({ revision: 1, expires_at: time }, now)).toContain('已到期');
    expect(new Date(localMinute(time)).valueOf()).toBe(now);
  });
});

describe('local expiry minute', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('distinguishes repeated minutes, gaps and ordinary minutes', () => {
    vi.stubEnv('TZ', 'America/New_York');
    expect(localMinuteOptions('2026-11-01T01:30')).toEqual([
      { value: '2026-11-01T05:30:00.000Z', offset: 'UTC-04:00' },
      { value: '2026-11-01T06:30:00.000Z', offset: 'UTC-05:00' },
    ]);
    expect(localMinuteOptions('2026-03-08T02:30')).toEqual([]);
    expect(localMinuteOptions('2026-11-01T00:30')).toEqual([
      { value: '2026-11-01T04:30:00.000Z', offset: 'UTC-04:00' },
    ]);
  });

  it('uses the actual rollback rather than assuming one hour', () => {
    vi.stubEnv('TZ', 'Australia/Lord_Howe');
    expect(localMinuteOptions('2026-04-05T01:45')).toEqual([
      { value: '2026-04-04T14:45:00.000Z', offset: 'UTC+11:00' },
      { value: '2026-04-04T15:15:00.000Z', offset: 'UTC+10:30' },
    ]);
  });
});
