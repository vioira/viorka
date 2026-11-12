import { afterEach, expect, it, vi } from 'vitest';
import {
  getTCPHistory,
  mergeTCPHistory,
  parseTCPHistory,
  tcpHistoryBlocks,
  tcpHistorySlots,
  tcpHistorySummary,
  tcpRanges,
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

it('keeps interval summaries stable across refreshes and all ranges', () => {
  for (const range of Object.keys(tcpRanges) as (keyof typeof tcpRanges)[]) {
    const { period, seconds } = tcpRanges[range];
    const failure = { ...probe(period * 4 + 10, 80), bucket_start: start / 1000 + period * 4 };
    const healthy = { ...probe(period * 5 + 10, 20), bucket_start: start / 1000 + period * 5 };
    healthy.targets[0].loss = 0;
    const history = {
      start: new Date(start).toISOString(),
      end: new Date(start + seconds * 1000).toISOString(),
      period_seconds: period,
      points: [failure, healthy],
    };
    const now = Date.parse(history.end);
    const before = tcpHistoryBlocks(history, 'example.com:443', range, now);
    const after = tcpHistoryBlocks(
      structuredClone(history),
      'example.com:443',
      range,
      now + period * 1000,
    );
    const red = before.find((b) => b.point && b.point.loss > 0);
    expect(red).toBeDefined();
    expect(after.find((b) => b.start === red?.start)).toEqual(red);
    expect(tcpHistoryBlocks(history, 'missing:443', range, now).every((b) => !b.point)).toBe(true);
  }
});
it('omits the partial left edge but retains gaps inside the queried range', () => {
  const history = {
    start: new Date(start + 170000).toISOString(),
    end: new Date(start + 3770000).toISOString(),
    period_seconds: 60,
    points: [{ ...probe(190, 80), bucket_start: start / 1000 + 180 }],
  };
  const blocks = tcpHistoryBlocks(history, 'example.com:443', '1h', Date.parse(history.end));
  expect(blocks[0].start).toBe(start / 1000 + 180);
  expect(blocks[0].point?.ping).toBe(80);
  expect(blocks[1].start).toBe(start / 1000 + 360);
  expect(blocks[1].point).toBeUndefined();
  expect(blocks.at(-1)?.end).toBe(start / 1000 + 3600);
});

it('hides unfinished blocks and summarizes their samples once the interval closes', () => {
  const failure = { ...probe(70, -1), bucket_start: start / 1000 + 60 };
  failure.targets[0].loss = 100;
  const healthy = { ...probe(130, 20), bucket_start: start / 1000 + 120 };
  healthy.targets[0].loss = 0;
  const history = {
    start: new Date(start - 3600000).toISOString(),
    end: new Date(start + 140000).toISOString(),
    period_seconds: 60,
    points: [failure, healthy],
  };
  const now = start + 140000;
  const before = tcpHistoryBlocks(history, 'example.com:443', '1h', now);
  expect(before.at(-1)?.end).toBe(start / 1000);
  expect(before.every((b) => !b.point)).toBe(true);
  const after = tcpHistoryBlocks(
    { ...history, end: new Date(start + 190000).toISOString() },
    'example.com:443',
    '1h',
    start + 190000,
  );
  expect(after.at(-1)?.start).toBe(start / 1000);
  expect(after.at(-1)?.end).toBe(start / 1000 + 180);
  expect(after.at(-1)?.point).toEqual({ target: 'example.com:443', ping: 20, loss: 50 });
  expect(tcpHistoryBlocks(history, 'example.com:443', '1h', start + 190000)).toEqual(before);
  expect(
    tcpHistoryBlocks({ ...history, points: [healthy] }, 'example.com:443', '1h', now).every(
      (b) => !b.point,
    ),
  ).toBe(true);
});

it('summarizes all available historical snapshots and updates with the selected range', () => {
  const samples = [probe(10, 20), probe(70, 40), probe(130, -1), probe(190, 100)];
  samples.forEach((p, i) => {
    p.targets[0].loss = [0, 16, 100, 0][i];
  });
  const history = {
    start: new Date(start).toISOString(),
    end: new Date(start + 3600000).toISOString(),
    period_seconds: 60,
    points: samples.map((p, i) => ({ ...p, bucket_start: start / 1000 + i * 60 })),
  };
  expect(tcpHistorySummary(history, 'example.com:443')).toEqual({
    target: 'example.com:443',
    ping: 40,
    loss: 29,
  });
  expect(
    tcpHistorySummary({ ...history, points: history.points.slice(0, 2) }, 'example.com:443'),
  ).toEqual({ target: 'example.com:443', ping: 30, loss: 8 });
  expect(tcpHistorySummary({ ...history, points: [history.points[2]] }, 'example.com:443')).toEqual(
    { target: 'example.com:443', ping: -1, loss: 100 },
  );
  expect(tcpHistorySummary({ ...history, points: [] }, 'example.com:443')).toBeUndefined();
  expect(tcpHistorySummary(history, 'missing:443')).toBeUndefined();
  expect(tcpHistorySummary(undefined, 'example.com:443')).toBeUndefined();
});

it('summarizes only snapshots in each block without filling missing samples', () => {
  const samples = [probe(10, 20), probe(70, 80), probe(180, 200)];
  samples.forEach((p, i) => {
    p.targets[0].loss = [16, 0, 100][i];
  });
  const history = {
    start: new Date(start).toISOString(),
    end: new Date(start + 3600000).toISOString(),
    period_seconds: 60,
    points: samples.map((p) => ({
      ...p,
      bucket_start: Math.floor(Date.parse(p.sampled_at) / 60000) * 60,
    })),
  };
  const blocks = tcpHistoryBlocks(history, 'example.com:443', '1h', Date.parse(history.end));
  expect(blocks[0].point).toEqual({ target: 'example.com:443', ping: 50, loss: 8 });
  expect(blocks[1].point).toEqual({ target: 'example.com:443', ping: 200, loss: 100 });
  expect(blocks[2].point).toBeUndefined();
});
