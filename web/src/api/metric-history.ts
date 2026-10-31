import { ApiError, apiRequest } from './client';
export type HistoryRange = '1h' | '6h' | '24h' | '7d';
export type Statistic = { sum: number; max: number; count: number };
export type HistoryPoint = { at: string; last_sample_at: string; stats: Record<string, Statistic> };
export type MetricHistory = { period_seconds: number; points: HistoryPoint[] };
export const rangeSeconds: Record<HistoryRange, number> = {
  '1h': 3600,
  '6h': 21600,
  '24h': 86400,
  '7d': 604800,
};
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const date = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
export function isMetricHistory(v: unknown): v is MetricHistory {
  return (
    record(v) &&
    [60, 300, 900].includes(v.period_seconds as number) &&
    Array.isArray(v.points) &&
    v.points.length <= 674 &&
    v.points.every(
      (p, i, points) =>
        record(p) &&
        date(p.at) &&
        date(p.last_sample_at) &&
        (i === 0 || Date.parse(p.at as string) > Date.parse(points[i - 1].at)) &&
        record(p.stats) &&
        Object.values(p.stats).every(
          (s) =>
            record(s) &&
            typeof s.sum === 'number' &&
            Number.isFinite(s.sum) &&
            s.sum >= 0 &&
            typeof s.max === 'number' &&
            Number.isFinite(s.max) &&
            s.max >= 0 &&
            Number.isSafeInteger(s.count) &&
            (s.count as number) > 0,
        ),
    )
  );
}
export async function getMetricHistory(
  id: string,
  range: HistoryRange,
  signal?: AbortSignal,
): Promise<MetricHistory> {
  const v = await apiRequest<unknown>(`/nodes/${encodeURIComponent(id)}/metrics/history`, {
    signal,
    query: { range },
  });
  if (!isMetricHistory(v)) throw new ApiError('历史指标格式无效，请刷新重试。', 'invalid-response');
  return v;
}
// Return separate continuous runs; never connect across missing buckets/metrics.
export function historyRuns(points: HistoryPoint[], key: string, period: number): HistoryPoint[][] {
  const runs: HistoryPoint[][] = [];
  let current: HistoryPoint[] = [];
  for (const point of points) {
    if (!point.stats[key]) {
      current = [];
      continue;
    }
    if (
      !current.length ||
      Date.parse(point.at) - Date.parse(current[current.length - 1].at) > period * 1000
    ) {
      current = [];
      runs.push(current);
    }
    current.push(point);
  }
  return runs;
}
