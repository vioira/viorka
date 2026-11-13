import { describe, expect, it } from 'vitest';
import { mergeMetricSummaryFrame, parseMetricSummaryFrame } from './metric-summary';
import { newerMonitoring } from './monitoring';
import {
  type LivePoint,
  type LiveSnapshot,
  mergeMetricFrame,
  parseMetricFrame,
  parseResourceChange,
} from './realtime';

const point = (sequence: number): LivePoint => ({
  sequence,
  at: new Date(sequence * 1000).toISOString(),
  received_at: new Date(sequence * 1000).toISOString(),
  values: { cpu: 25 },
});
const snapshot = (sequence: number, points: LivePoint[], reset = false): LiveSnapshot => ({
  sequence,
  points: [],
  telemetry: {
    run_id: '00000000-0000-4000-8000-000000000001',
    sequence,
    reset,
    metrics_received_at: new Date(sequence * 1000).toISOString(),
    fast_received_at: new Date(sequence * 1000).toISOString(),
    full_received_at: new Date(sequence * 1000).toISOString(),
    public_ip_received_at: new Date(sequence * 1000).toISOString(),
    fast_stale: true,
    full_stale: true,
    public_ip_stale: true,
    points: points.map((p) => ({ ...p, sample_sequence: String(p.sequence) })),
  },
  reset,
  stale: false,
  received_at: new Date(sequence * 1000).toISOString(),
  history: [],
});
describe('metric stream recovery', () => {
  it('replaces raw payloads, ignores late updates and restores a new cache generation', () => {
    const initial = mergeMetricFrame(
      {},
      { reset: true, items: { n: snapshot(1, [point(1)], true) }, removed_ids: [] },
    );
    const next = mergeMetricFrame(initial, {
      reset: false,
      items: { n: snapshot(3, [point(2), point(3)]) },
      removed_ids: [],
    });
    expect(next.n.telemetry?.points.map((p) => p.sequence)).toEqual([2, 3]);
    expect(
      mergeMetricFrame(next, {
        reset: false,
        items: { n: snapshot(2, [point(2)]) },
        removed_ids: [],
      }).n.sequence,
    ).toBe(3);
    const restarted = mergeMetricFrame(next, {
      reset: true,
      items: { n: snapshot(1, [point(1)], true) },
      removed_ids: [],
    });
    expect(restarted.n.telemetry?.points).toHaveLength(1);
    expect(mergeMetricFrame(restarted, { reset: false, items: {}, removed_ids: ['n'] })).toEqual(
      {},
    );
  });
  it('rejects corrupt, unordered and oversized frames', () => {
    const valid = {
      reset: true,
      items: { n: snapshot(2, [point(1), point(2)], true) },
      removed_ids: [],
    };
    expect(parseMetricFrame(JSON.stringify(valid))).toEqual(valid);
    for (const points of [
      [point(2), point(1)],
      [{ ...point(1), values: { cpu: -1 } }],
      Array.from({ length: 601 }, (_, i) => point(i + 1)),
    ]) {
      expect(() =>
        parseMetricFrame(JSON.stringify({ ...valid, items: { n: snapshot(302, points, true) } })),
      ).toThrow();
    }
    expect(() => parseResourceChange('{"kind":"shell"}')).toThrow();
  });
});

it('allows a manual REST refresh to supersede a disconnected stream cache', () => {
  const old = snapshot(1, [point(1)]);
  const fresh = snapshot(2, [point(2)]);
  expect(newerMonitoring(old, fresh)).toBe(fresh);
  expect(newerMonitoring(fresh, old)).toBe(fresh);
});

it('accepts compact list metrics and removes/reset rows without full telemetry', () => {
  const sample = {
    received_at: '2026-11-10T00:00:00Z',
    expires_at: '2026-11-10T00:01:30Z',
    cpu: 0,
    memory: null,
  };
  const frame = parseMetricSummaryFrame(
    JSON.stringify({ reset: true, items: { n: sample }, removed_ids: [] }),
  );
  expect(mergeMetricSummaryFrame({ old: sample }, frame)).toEqual({ n: sample });
  expect(
    mergeMetricSummaryFrame({ n: sample }, { reset: false, items: {}, removed_ids: ['n'] }),
  ).toEqual({});
  expect(() =>
    parseMetricSummaryFrame(JSON.stringify({ ...frame, items: { n: { ...sample, memory: 101 } } })),
  ).toThrow();
});

it('applies the server chart windows additions, removals and resets without slicing', () => {
  const trendPoint = (id: string, at: number) => ({
    id,
    at: new Date(at).toISOString(),
    source: 'live' as const,
    values: { rx: at, tx: null },
  });
  const frame = (
    seq: number,
    trend: Omit<import('./metric-trends').MetricTrend, 'period_seconds' | 'statistic'>,
  ) => ({
    reset: false,
    removed_ids: [],
    items: {
      n: {
        ...snapshot(seq, []),
        metric_trends: { network: { ...trend, period_seconds: 30, statistic: 'peak' as const } },
      },
    },
  });
  const initial = mergeMetricFrame(
    {},
    frame(1, {
      reset: true,
      points: [trendPoint('a', 1000), trendPoint('b', 2000)],
      removed_ids: [],
    }),
  );
  const next = mergeMetricFrame(
    initial,
    frame(2, { reset: false, points: [trendPoint('c', 3000)], removed_ids: ['a'] }),
  );
  expect(next.n.metric_trends?.network.points.map((p) => p.id)).toEqual(['b', 'c']);
  const repeat = mergeMetricFrame(
    next,
    frame(2, { reset: false, points: [trendPoint('c', 3000)], removed_ids: ['a'] }),
  );
  expect(repeat.n.metric_trends?.network.points.map((p) => p.id)).toEqual(['b', 'c']);
  const reset = mergeMetricFrame(
    next,
    frame(3, { reset: true, points: [trendPoint('d', 4000)], removed_ids: [] }),
  );
  expect(reset.n.metric_trends?.network.points.map((p) => p.id)).toEqual(['d']);
  expect(() =>
    parseMetricFrame(
      JSON.stringify(
        frame(3, {
          reset: true,
          points: Array.from({ length: 121 }, (_, i) => trendPoint(String(i), i)),
          removed_ids: [],
        }),
      ),
    ),
  ).toThrow();
});

it('preserves exact daily counters in list summaries and rejects corrupt traffic', () => {
  const sample = {
    received_at: '2026-11-13T12:00:00Z',
    expires_at: '2026-11-13T12:01:30Z',
    cpu: null,
    memory: null,
    daily_traffic: {
      day_start: '2026-11-13T00:00:00Z',
      day_end: '2026-11-14T00:00:00Z',
      sampled_at: '2026-11-13T12:00:00Z',
      rx_bytes: '9007199254740993',
      tx_bytes: '0',
      revision: 1,
      quality: 0,
    },
    traffic_billing_mode: 'outbound',
    traffic_expires_at: '2026-11-13T12:01:30Z',
  };
  const frame = { reset: true, items: { n: sample }, removed_ids: [] };
  expect(parseMetricSummaryFrame(JSON.stringify(frame)).items.n.daily_traffic?.rx_bytes).toBe(
    '9007199254740993',
  );
  expect(() =>
    parseMetricSummaryFrame(
      JSON.stringify({
        ...frame,
        items: { n: { ...sample, daily_traffic: { ...sample.daily_traffic, tx_bytes: '-1' } } },
      }),
    ),
  ).toThrow();
});
