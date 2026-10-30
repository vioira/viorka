import { describe, expect, it } from 'vitest';
import {
  bytes,
  isMonitoringSnapshot,
  isStale,
  type MonitoringSnapshot,
  percent,
  recentSeries,
} from './monitoring';

const time = '2026-01-01T00:00:00Z';
const snapshot: MonitoringSnapshot = {
  received_at: time,
  stale: false,
  history: [],
  latest: {
    sampled_at: time,
    interval_seconds: 30,
    errors: [],
    interfaces: [],
    cpu: { logical_cpus: 2, usage_percent: 0 },
  },
};
describe('monitoring truthfulness', () => {
  it('retains real zero but never invents missing values', () => {
    expect(bytes(0)).toBe('0 B');
    expect(bytes(undefined)).toBe('未知');
    expect(percent(undefined, 100)).toBeNull();
    expect(percent(0, 100)).toBe(0);
    expect(isMonitoringSnapshot(snapshot)).toBe(true);
  });
  it('marks data stale on age or disconnect even if CPU is zero', () => {
    expect(isStale(snapshot, Date.parse(time) + 90000)).toBe(false);
    expect(isStale(snapshot, Date.parse(time) + 91000)).toBe(true);
    expect(isStale({ ...snapshot, stale: true }, Date.parse(time))).toBe(true);
    expect(isStale(undefined, 0)).toBe(true);
  });
  it('rejects malformed payloads without replacing inventory with a fake success', () => {
    for (const v of [
      null,
      {},
      { ...snapshot, history: null },
      { ...snapshot, latest: { ...snapshot.latest, cpu: null } },
      { ...snapshot, latest: { ...snapshot.latest, cpu: { logical_cpus: 2, usage_percent: 101 } } },
      { ...snapshot, latest: { ...snapshot.latest, interfaces: [null] } },
    ])
      expect(isMonitoringSnapshot(v)).toBe(false);
  });
  it('does not connect a chart across missing counters or offline time', () => {
    const points = [
      { at: time, cpu: 20 },
      { at: '2026-01-01T00:01:00Z' },
      { at: '2026-01-01T00:02:00Z', cpu: 0 },
    ];
    expect(recentSeries(points, 'cpu')).toEqual([points[2]]);
    expect(recentSeries(points.slice(0, 2), 'cpu')).toEqual([]);
    expect(
      recentSeries(
        [
          { at: time, cpu: 20 },
          { at: '2026-01-01T00:05:00Z', cpu: 30 },
        ],
        'cpu',
      ),
    ).toHaveLength(1);
  });
});
