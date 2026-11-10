import { describe, expect, it } from 'vitest';
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
  it('appends batches, ignores late updates and restores a new cache generation', () => {
    const initial = mergeMetricFrame(
      {},
      { reset: true, items: { n: snapshot(1, [point(1)], true) }, removed_ids: [] },
    );
    const next = mergeMetricFrame(initial, {
      reset: false,
      items: { n: snapshot(3, [point(2), point(3)]) },
      removed_ids: [],
    });
    expect(next.n.telemetry?.points.map((p) => p.sequence)).toEqual([1, 2, 3]);
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
  it('bounds the rolling window and does not repeat points', () => {
    const old = {
      n: snapshot(
        900,
        Array.from({ length: 900 }, (_, i) => point(i + 1)),
      ),
    };
    const frame = {
      reset: false,
      items: { n: snapshot(902, [point(900), point(901), point(902)]) },
      removed_ids: [],
    };
    const next = mergeMetricFrame(old, frame);
    expect(next.n.telemetry?.points).toHaveLength(600);
    expect(next.n.telemetry?.points[0].sequence).toBe(303);
    expect(mergeMetricFrame(next, frame)).toEqual(next);
  });
  it('keeps only the ten-minute points when connecting or reconnecting', () => {
    const frame = {
      reset: true,
      items: {
        n: snapshot(
          600,
          Array.from({ length: 600 }, (_, i) => point(i + 1)),
          true,
        ),
      },
      removed_ids: [],
    };
    const parsed = parseMetricFrame(JSON.stringify(frame));
    const caches: Record<string, LiveSnapshot>[] = [{}, { n: snapshot(1, [point(1)]) }];
    for (const current of caches) {
      const next = mergeMetricFrame(current, parsed);
      expect(next.n.telemetry?.points.map((p) => p.sequence)).toEqual(
        Array.from({ length: 600 }, (_, i) => i + 1),
      );
    }
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

it('retains minute bootstrap points then appends raw samples within ten minutes', () => {
  const initial = mergeMetricFrame(
    {},
    {
      reset: true,
      items: { n: snapshot(599, [point(60), point(120), point(599)], true) },
      removed_ids: [],
    },
  );
  const next = mergeMetricFrame(initial, {
    reset: false,
    items: { n: snapshot(601, [point(600), point(601)]) },
    removed_ids: [],
  });
  expect(next.n.telemetry?.points.map((p) => p.sequence)).toEqual([60, 120, 599, 600, 601]);
  const expired = mergeMetricFrame(next, {
    reset: false,
    items: { n: snapshot(721, [point(721)]) },
    removed_ids: [],
  });
  expect(expired.n.telemetry?.points.map((p) => p.sequence)).toEqual([599, 600, 601, 721]);
});

it('preserves collected raw points when the same Agent reconnects with a bounded snapshot', () => {
  const current = { n: snapshot(4, [point(1), point(2), point(3), point(4)]) };
  const next = mergeMetricFrame(current, {
    reset: true,
    items: { n: snapshot(5, [point(4), point(5)], true) },
    removed_ids: [],
  });
  expect(next.n.telemetry?.points.map((p) => p.sequence)).toEqual([1, 2, 3, 4, 5]);
});
