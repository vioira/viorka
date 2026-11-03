import { afterEach, expect, it, vi } from 'vitest';
import { getMetricHistory, type HistoryPoint, historyRuns } from './metric-history';

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
afterEach(() => vi.unstubAllGlobals());
it('requests the selected history range through the canonical API client', async () => {
  vi.stubGlobal('location', { origin: 'http://localhost' });
  let url = '';
  vi.stubGlobal('fetch', async (request: Request) => {
    url = request.url;
    return Response.json({ period_seconds: 3600, points: [] });
  });
  const result = await getMetricHistory('node-1', '7d');
  expect(result.points).toEqual([]);
  expect(url).toBe('http://localhost/api/v1/nodes/node-1/metrics/history?range=7d');
});

it('requests the two-day range', async () => {
  vi.stubGlobal('location', { origin: 'http://localhost' });
  vi.stubGlobal('fetch', async (request: Request) => {
    expect(new URL(request.url).searchParams.get('range')).toBe('2d');
    return Response.json({ period_seconds: 1440, points: [] });
  });
  expect((await getMetricHistory('n', '2d')).period_seconds).toBe(1440);
});

it('rejects the obsolete stats wire shape rather than showing fabricated history', async () => {
  vi.stubGlobal('location', { origin: 'http://localhost' });
  vi.stubGlobal('fetch', async () => Response.json({ period_seconds: 30, points: [point(0)] }));
  await expect(getMetricHistory('n', '1h')).rejects.toThrow('历史指标格式无效');
});
