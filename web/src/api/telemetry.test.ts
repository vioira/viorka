import { describe, expect, it } from 'vitest';
import { telemetryChartPoints, telemetryCharts } from '@/views/nodes/components/telemetry-chart';
import { isMonitoringSnapshot, isStale } from './monitoring';
import { type LiveSnapshot, mergeMetricFrame, parseMetricFrame } from './realtime';
import {
  decimalBytes,
  decimalPercent,
  filesystemUsagePercent,
  isTelemetrySnapshot,
  type TelemetrySnapshot,
  telemetryStale,
} from './telemetry';

const at = '2026-01-01T00:00:00Z';
const time = Date.parse(at);
function telemetry(): TelemetrySnapshot {
  return {
    run_id: '00000000-0000-4000-8000-000000000001',
    sequence: 1,
    reset: true,
    settings: {
      revision: 1,
      collection_seconds: 60,
      http_report_seconds: 30,
      wss_report_seconds: 2,
      connection_mode: 'auto_http_wss',
    },
    metrics_received_at: at,
    fast_received_at: at,
    full_received_at: at,
    public_ip_received_at: at,
    fast_stale: false,
    full_stale: false,
    public_ip_stale: false,
    fast: {
      sequence: '9007199254740993',
      sampled_at: at,
      elapsed_seconds: 60,
      cpu_percent: 0,
      ram_total: '9007199254740993',
      ram_used: '4503599627370496',
      filter_revision: 'a'.repeat(64),
      interfaces: [],
      errors: [],
      traffic: {
        month_start: at,
        rx_bytes: '9007199254740993',
        tx_bytes: '0',
        filter_revision: 'a'.repeat(64),
        quality: ['partial'],
      },
    },
    full: {
      sequence: '1',
      sampled_at: at,
      elapsed_seconds: 30,
      filesystems: [],
      disk_io: [],
      errors: [],
    },
    public_ip: { sequence: '1', sampled_at: at, ipv4: '203.0.113.1', errors: [] },
    points: [
      {
        sequence: 1,
        sample_sequence: '9007199254740993',
        at,
        received_at: at,
        values: { cpu_percent: 0, memory_percent: 50 },
      },
    ],
  };
}
function snapshot(t = telemetry()): LiveSnapshot {
  return {
    management_online: false,
    telemetry: t,
    telemetry_control: { mode: 'http', references: 0, lease_remaining_seconds: 0 },
    received_at: t.metrics_received_at,
    stale: false,
    history: [],
    sequence: t.sequence,
    reset: t.reset,
    points: [],
  };
}
const frame = (s: LiveSnapshot) => ({ reset: false, items: { n: s }, removed_ids: [] });
describe('telemetry REST/SSE contract', () => {
  it('accepts exact decimal counters, C greater than R, and empty negotiation snapshots', () => {
    expect(isMonitoringSnapshot(snapshot())).toBe(true);
    expect(
      parseMetricFrame(JSON.stringify(frame(snapshot()))).items.n.telemetry?.fast?.sequence,
    ).toBe('9007199254740993');
    const t = telemetry();
    delete t.fast;
    delete t.full;
    delete t.public_ip;
    t.run_id = '';
    t.points = [];
    t.sequence = 0;
    expect(isTelemetrySnapshot(t)).toBe(true);
  });
  it('ages each group from its own sample and receipt, independent of management', () => {
    const s = snapshot();
    expect(isStale(s, time + 179999)).toBe(false);
    expect(isStale(s, time + 180000)).toBe(true);
    const t = telemetry();
    t.metrics_received_at = new Date(time + 180000).toISOString();
    expect(telemetryStale(t, 'fast', time + 180000)).toBe(true);
    expect(telemetryStale(t, 'full', time + 90000)).toBe(true);
    expect(telemetryStale(t, 'public_ip', time + 1799999)).toBe(false);
    expect(telemetryStale(t, 'public_ip', time + 1800000)).toBe(true);
    expect(
      telemetryStale(t, 'fast', time + 90000, {
        mode: 'realtime',
        references: 1,
        lease_remaining_seconds: 90,
      }),
    ).toBe(true);
  });
  it('merges nested delta points once, updates mode without adding points, resets on a new run', () => {
    const initial = mergeMetricFrame({}, frame(snapshot()));
    const next = telemetry();
    next.reset = false;
    next.sequence = 2;
    next.points = [{ ...next.points[0], sequence: 2, sample_sequence: '9007199254740994' }];
    const combined = mergeMetricFrame(initial, frame(snapshot(next)));
    expect(combined.n.telemetry?.points.map((p) => p.sequence)).toEqual([1, 2]);
    expect(mergeMetricFrame(combined, frame(snapshot(next)))).toEqual(combined);
    const control = snapshot({ ...next, points: [] });
    control.telemetry_control = { mode: 'pending', references: 1, lease_remaining_seconds: 90 };
    expect(mergeMetricFrame(combined, frame(control)).n.telemetry?.points).toHaveLength(2);
    expect(mergeMetricFrame(combined, frame(control)).n.telemetry_control?.mode).toBe('pending');
    const restarted = telemetry();
    restarted.run_id = '00000000-0000-4000-8000-000000000002';
    expect(mergeMetricFrame(combined, frame(snapshot(restarted))).n.telemetry?.points).toHaveLength(
      1,
    );
  });
  it('retains 600 raw samples and expires them by observation time', () => {
    const t = telemetry();
    t.sequence = 600;
    t.metrics_received_at = new Date(time + 600000).toISOString();
    t.points = Array.from({ length: 600 }, (_, i) => ({
      sequence: i + 1,
      sample_sequence: String(i + 1),
      at: new Date(time + (i + 1) * 1000).toISOString(),
      received_at: t.metrics_received_at,
      values: { cpu_percent: i % 100 },
    }));
    const parsed = parseMetricFrame(JSON.stringify(frame(snapshot(t))));
    const merged = mergeMetricFrame({}, parsed);
    expect(merged.n.telemetry?.points).toHaveLength(600);
    const later = {
      ...t,
      reset: false,
      points: [],
      metrics_received_at: new Date(time + 900000).toISOString(),
    };
    expect(mergeMetricFrame(merged, frame(snapshot(later))).n.telemetry?.points).toHaveLength(300);
  });
  it('rejects malformed groups, rounded counters, cursor mismatch and invalid settings', () => {
    for (const patch of [
      { points: null },
      { sequence: -1 },
      { fast: { ...telemetry().fast, ram_total: 9007199254740992 } },
      { settings: { ...telemetry().settings, collection_seconds: 61 } },
      { full: { ...telemetry().full, disk_io: Array(65).fill({}) } },
    ]) {
      expect(isTelemetrySnapshot({ ...telemetry(), ...patch })).toBe(false);
    }
    const bad = snapshot();
    bad.sequence = 2;
    expect(() => parseMetricFrame(JSON.stringify(frame(bad)))).toThrow('游标');
  });
  it('maps actual fast fields without zero fill or host disk sums', () => {
    const t = telemetry();
    expect(telemetryChartPoints(t)[0].values).toEqual({ cpu: 0, memory: 50 });
    const charts = telemetryCharts(t, time);
    expect(charts.find((c) => c.key === 'cpu')?.value).toBe('0.0%');
    expect(charts.some((c) => c.key === 'disk_io')).toBe(false);
    expect(telemetryCharts(t, time + 180000).find((c) => c.key === 'cpu')?.value).toBe('未知');
  });
  it('uses exact df-style usage and renders unavailable capacity without a percent suffix', () => {
    expect(filesystemUsagePercent('250', '500')).toBe(34);
    expect(filesystemUsagePercent('9007199254740993', '9007199254740992')).toBe(51);
    expect(filesystemUsagePercent('0', '1')).toBe(0);
    expect(filesystemUsagePercent('1', '0')).toBe(100);
    expect(filesystemUsagePercent('0', '0')).toBeNull();
    expect(filesystemUsagePercent('1', undefined)).toBeNull();
    const t = telemetry();
    expect(telemetryCharts(t, time).find((c) => c.key === 'disk')?.detail).toBe('使用率未知');
    if (t.full)
      Object.assign(t.full, { disk_used: '250', disk_total: '1000', disk_available: '500' });
    expect(telemetryCharts(t, time).find((c) => c.key === 'disk')?.detail).toBe(
      '使用率 34%（不含保留空间）',
    );
  });
  it('formats integers with BigInt arithmetic and never manufactures missing counters', () => {
    expect(decimalBytes('9007199254740993')).toBe('8.0 PiB');
    expect(decimalBytes('0')).toBe('0 B');
    expect(decimalBytes()).toBe('未知');
    expect(decimalBytes('1e3')).toBe('未知');
    expect(decimalPercent('4503599627370496', '9007199254740993')).toBe(50);
    expect(decimalPercent('0', '0')).toBeNull();
  });
});
