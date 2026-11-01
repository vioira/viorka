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
  points,
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
    expect(next.n.points.map((p) => p.sequence)).toEqual([1, 2, 3]);
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
    expect(restarted.n.points).toHaveLength(1);
    expect(mergeMetricFrame(restarted, { reset: false, items: {}, removed_ids: ['n'] })).toEqual(
      {},
    );
  });
  it('bounds the rolling window and does not repeat points', () => {
    const old = {
      n: snapshot(
        300,
        Array.from({ length: 300 }, (_, i) => point(i + 1)),
      ),
    };
    const frame = {
      reset: false,
      items: { n: snapshot(302, [point(300), point(301), point(302)]) },
      removed_ids: [],
    };
    const next = mergeMetricFrame(old, frame);
    expect(next.n.points).toHaveLength(120);
    expect(next.n.points[0].sequence).toBe(183);
    expect(mergeMetricFrame(next, frame)).toEqual(next);
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
      Array.from({ length: 121 }, (_, i) => point(i + 1)),
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
  expect(next.n.points.map((p) => p.sequence)).toEqual([60, 120, 599, 600, 601]);
  const expired = mergeMetricFrame(next, {
    reset: false,
    items: { n: snapshot(721, [point(721)]) },
    removed_ids: [],
  });
  expect(expired.n.points.map((p) => p.sequence)).toEqual([599, 600, 601, 721]);
});
