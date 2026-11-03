import { describe, expect, it } from 'vitest';
import { historyMetricCharts, metricCharts } from '@/views/nodes/components/metric-chart';
import { parseHistoryResponse } from './history-wire';

const mean = (sum: number | null = null, count = 0) => ({
  avg: sum === null || count === 0 ? null : sum / count,
});
const peak = (max: number | null = null, _count = 0) => ({ max });
function bucket() {
  return {
    bucket_start: 1767225600,
    last_sample_at: 1767225629000,
    metric_semantics: 'telemetry_v3',
    quality_flags: 0,
    cpu: mean(90, 3),
    ram_used: mean(1200, 3),
    swap_used: mean(),
    net_in_speed: peak(500, 3),
    net_out_speed: peak(0, 1),
    tcp_count: peak(),
    udp_count: peak(),
    process_count: peak(12, 2),
    ram_total: '1000',
    swap_total: '0',
    disk_total: '1000',
    disk_used: '250',
    disk_available: '750',
    net_in_total: '9007199254740993',
    net_out_total: '0',
    net_month_in: '9007199254740993',
    net_month_out: null,
    load_1: 0,
    load_5: null,
    load_15: 1.5,
    disk_io: {
      sampled_at: 0,
      quality_flags: 0,
      read_speed: peak(),
      write_speed: peak(),
      read_iops: peak(),
      write_iops: peak(),
      read_await_ms: peak(),
      write_await_ms: peak(),
      await_ms: peak(),
      util_percent: peak(),
    },
  };
}
const parse = (b = bucket()) => parseHistoryResponse({ period_seconds: 30, points: [b] });
describe('typed history wire conversion', () => {
  it('preserves bucket averages, sampled peaks, latest values and exact counters', () => {
    const result = parse();
    expect(result?.typed).toBe(true);
    const p = result?.points[0];
    expect(p?.at).toBe('2026-01-01T00:00:00.000Z');
    expect(p?.last_sample_at).toBe('2026-01-01T00:00:29.000Z');
    expect(p?.stats.cpu).toEqual({ sum: 30, max: 30, count: 1, kind: 'mean' });
    expect(p?.stats.memory).toEqual({ sum: 40, max: 40, count: 1, kind: 'mean' });
    expect(p?.stats.rx).toEqual({ sum: 500, max: 500, count: 1, kind: 'peak' });
    expect(p?.stats.disk).toEqual({ sum: 25, max: 25, count: 1, kind: 'latest' });
    expect(p?.bucket?.net_month_in).toBe('9007199254740993');
  });
  it('keeps unknown data absent and real zeroes present', () => {
    const stats = parse()?.points[0].stats;
    expect(stats?.swap).toBeUndefined();
    expect(stats?.tcp_sockets).toBeUndefined();
    expect(stats?.load_five).toBeUndefined();
    expect(stats?.tx.max).toBe(0);
    expect(stats?.load_one.max).toBe(0);
    const b = bucket();
    b.ram_total = '0';
    expect(parse(b)?.points[0].stats.memory).toBeUndefined();
  });
  it('uses df-style capacities and never displays retired root history', () => {
    const b = { ...bucket(), disk_available: '500' };
    expect(parse(b)?.points[0].stats.disk.max).toBe(34);
    b.disk_available = '0';
    b.disk_used = '0';
    expect(parse(b)?.points[0].stats.disk).toBeUndefined();
    const chart = historyMetricCharts(metricCharts(), parse()).find((c) => c.key === 'disk');
    expect(chart?.series.map((s) => s.key)).toEqual(['disk']);
  });
  it('uses one node IO summary with six nullable peak values', () => {
    const b = bucket();
    b.disk_io.read_speed = peak(100, 2);
    b.disk_io.write_speed = peak(0, 2);
    b.disk_io.quality_flags = 1;
    const result = parse(b);
    const charts = historyMetricCharts(metricCharts(), result);
    expect(charts.find((c) => c.key === 'disk_io')?.series.map((s) => s.key)).toEqual([
      'disk_read',
      'disk_write',
    ]);
    expect(charts.some((c) => c.key.startsWith('disk_io:'))).toBe(false);
    expect(result?.points[0].stats.disk_read.max).toBe(100);
    expect(result?.points[0].stats.disk_write.max).toBe(0);
    expect(result?.points[0].stats.disk_await_ms).toBeUndefined();
    expect(
      parseHistoryResponse({ period_seconds: 30, points: [{ ...b, disk_io: [] }] }),
    ).toBeUndefined();
  });
  it.each([
    { cpu: { avg: -1 } },
    { cpu: { avg: Infinity } },
    { net_in_speed: { max: Infinity, count: 1 } },
    { net_in_total: 9007199254740992 },
    { net_in_total: '18446744073709551616' },
    { bucket_start: 1767225601 },
    { last_sample_at: 8640000000000001 },
    { ram_total: '-1' },
  ])('rejects malformed consumed fields: %o', (change) => {
    expect(
      parseHistoryResponse({ period_seconds: 30, points: [{ ...bucket(), ...change }] }),
    ).toBeUndefined();
  });
  it('rejects duplicate/out-of-order buckets and excess points', () => {
    expect(
      parseHistoryResponse({ period_seconds: 30, points: [bucket(), bucket()] }),
    ).toBeUndefined();
    expect(
      parseHistoryResponse({ period_seconds: 30, points: Array(170).fill(bucket()) }),
    ).toBeUndefined();
  });
});
