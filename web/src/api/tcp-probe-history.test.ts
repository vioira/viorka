import { afterEach, expect, it, vi } from 'vitest';
import {
  getTCPHistory,
  mergeTCPHistory,
  parseTCPHistory,
  tcpHistorySlots,
} from './tcp-probe-history';
import type { TCPProbeBatch } from './telemetry';

const start = Date.UTC(2026, 10, 12);
const probe = (seconds: number, ms: number): TCPProbeBatch => ({
  sampled_at: new Date(start + seconds * 1000).toISOString(),
  targets: [{ target: 'example.com:443', ping: ms, loss: 20 }],
});
it('selects latest samples without averaging overlapping windows or filling gaps', () => {
  const points = [probe(10, 20), probe(40, 80), probe(180, 100)];
  const slots = tcpHistorySlots(points, 'example.com:443', start, start + 240000, 60);
  expect(slots.map((s) => s.point?.ping)).toEqual([80, undefined, undefined, 100]);
  expect(slots[0].point?.loss).toBe(20);
  expect(
    tcpHistorySlots(points, 'other:443', start, start + 240000, 60).every((s) => !s.point),
  ).toBe(true);
  expect(
    tcpHistorySlots(points, 'example.com:443', start, start + 300000, 300)[0].point?.ping,
  ).toBe(100);
});
it('validates stored bucket membership, duplicate points and missing metrics', () => {
  const point = { ...probe(20, 30), bucket_start: start / 1000 };
  const raw = {
    start: new Date(start).toISOString(),
    end: new Date(start + 3600000).toISOString(),
    period_seconds: 60,
    points: [point],
  };
  expect(parseTCPHistory(raw)).toEqual(raw);
  expect(parseTCPHistory({ ...raw, points: [point, point] })).toBeUndefined();
  expect(
    parseTCPHistory({ ...raw, points: [{ ...point, bucket_start: point.bucket_start + 60 }] }),
  ).toBeUndefined();
  expect(
    parseTCPHistory({
      ...raw,
      points: [
        {
          ...point,
          targets: [{ target: 'example.com:443', ping: -1, loss: 100 }],
        },
      ],
    }),
  ).toBeDefined();
});
afterEach(() => vi.unstubAllGlobals());
it('loads the selected persisted range using the shared API client', async () => {
  vi.stubGlobal('location', { origin: 'http://localhost' });
  vi.stubGlobal('fetch', async (request: Request) => {
    expect(request.url).toBe('http://localhost/api/v1/nodes/n/tcp-probes/history?range=7d');
    return Response.json({
      start: new Date(start).toISOString(),
      end: new Date(start + 604800000).toISOString(),
      period_seconds: 3600,
      points: [],
    });
  });
  expect((await getTCPHistory('n', '7d')).points).toEqual([]);
});

it('merges incremental buckets, ignores older samples and removes expired targets', () => {
  const frame = {
    node_id: 'n',
    range: '1h',
    reset: true,
    targets: ['example.com:443'],
    start: new Date(start).toISOString(),
    end: new Date(start + 3600000).toISOString(),
    period_seconds: 60,
    points: [{ ...probe(10, 20), bucket_start: start / 1000 }],
  };
  const initial = mergeTCPHistory(undefined, frame, 'n', '1h');
  const delta = {
    ...frame,
    reset: false,
    points: [{ ...probe(40, 80), bucket_start: start / 1000 }],
  };
  const updated = mergeTCPHistory(initial, delta, 'n', '1h');
  expect(updated.points).toHaveLength(1);
  expect(updated.points[0].targets[0].ping).toBe(80);
  expect(
    mergeTCPHistory(updated, { ...frame, reset: false }, 'n', '1h').points[0].targets[0].ping,
  ).toBe(80);
  expect(mergeTCPHistory(updated, { ...delta, targets: [], points: [] }, 'n', '1h').points).toEqual(
    [],
  );
  expect(
    mergeTCPHistory(
      updated,
      { ...delta, start: new Date(start + 60000).toISOString(), points: [] },
      'n',
      '1h',
    ).points,
  ).toEqual([]);
  expect(() => mergeTCPHistory(undefined, delta, 'n', '1h')).toThrow();
  expect(() => mergeTCPHistory(initial, delta, 'other', '1h')).toThrow();
});

it('replaces whole target groups and never assigns a new target old history', () => {
  const old = probe(10, 20);
  const next = {
    sampled_at: probe(40, 40).sampled_at,
    targets: [{ target: 'other.example:443', ping: 40, loss: 0 }],
  };
  expect(
    tcpHistorySlots([old, next], 'example.com:443', start, start + 60000, 60)[0].point,
  ).toBeUndefined();
  expect(
    tcpHistorySlots([old, next], 'other.example:443', start, start + 60000, 60)[0].point?.ping,
  ).toBe(40);
});
