import { afterEach, expect, it, vi } from 'vitest';
import {
  getMetricHistory,
  type HistoryPoint,
  historyRuns,
  isMetricHistory,
} from './metric-history';

const point = (minute: number, valid = true): HistoryPoint => ({
  at: new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString(),
  last_sample_at: new Date(Date.UTC(2026, 0, 1, 0, minute, 30)).toISOString(),
  stats: valid ? { cpu: { sum: 30, max: 20, count: 2 } } : {},
});
it('keeps missing values and offline gaps separate', () => {
  const runs = historyRuns([point(0), point(1), point(3), point(4, false), point(5)], 'cpu', 60);
  expect(runs.map((r) => r.length)).toEqual([2, 1, 1]);
  expect(historyRuns([point(0, false)], 'cpu', 60)).toEqual([]);
});
it('accepts empty and partial history, rejects invalid counts, order and oversized responses', () => {
  expect(isMetricHistory({ period_seconds: 60, points: [] })).toBe(true);
  expect(isMetricHistory({ period_seconds: 60, points: [point(0), point(1, false)] })).toBe(true);
  expect(isMetricHistory({ period_seconds: 60, points: [point(1), point(0)] })).toBe(false);
  const bad = point(0);
  bad.stats.cpu.count = 0;
  expect(isMetricHistory({ period_seconds: 60, points: [bad] })).toBe(false);
  expect(
    isMetricHistory({
      period_seconds: 60,
      points: Array.from({ length: 675 }, (_, i) => point(i)),
    }),
  ).toBe(false);
});

afterEach(() => vi.unstubAllGlobals());
it('requests the selected history range through the canonical API client', async () => {
  vi.stubGlobal('location', { origin: 'http://localhost' });
  let url = '';
  vi.stubGlobal('fetch', async (request: Request) => {
    url = request.url;
    return Response.json({ period_seconds: 900, points: [] });
  });
  const result = await getMetricHistory('node-1', '7d');
  expect(result.points).toEqual([]);
  expect(url).toBe('http://localhost/api/v1/nodes/node-1/metrics/history?range=7d');
});
