import { describe, expect, it } from 'vitest';
import type { AlertSettings } from '@/api/alerts';
import { channelSummary } from './delivery';

const sample: AlertSettings = {
  config: {
    revision: 1,
    timezone: 'UTC',
    channels: ['a', 'b'].map((id) => ({ id, name: id, kind: 'telegram', target: '123' })),
    rules: [],
    templates: [],
  },
  credentials: { a: true, b: true },
  delivery: {},
};
const accepted = { state: 'accepted', at: '2026-11-23T01:00:00Z', detail: '' };
describe('通知渠道概览', () => {
  it('仅在全部渠道有接受回执时显示投递正常', () => {
    expect(channelSummary({ ...sample, delivery: { a: accepted } })).toBe('待验证');
    expect(channelSummary({ ...sample, delivery: { a: accepted, b: accepted } })).toBe('投递正常');
  });
  it('单个渠道投递失败时显示异常', () => {
    const result = channelSummary({
      ...sample,
      delivery: { b: { ...accepted, state: 'failed', at: '2026-11-23T00:50:00Z' }, a: accepted },
    });
    expect(result).toBe('投递失败');
  });
});
