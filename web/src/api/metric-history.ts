import { ApiError, apiRequest } from './client';
import { type HistoryBucket, parseHistoryResponse } from './history-wire';
export type HistoryRange = '1h' | '6h' | '24h' | '2d' | '7d';
export type Statistic = {
  sum: number;
  max: number;
  count: number;
  kind?: 'mean' | 'peak' | 'latest';
};
export type HistoryPoint = {
  at: string;
  last_sample_at: string;
  stats: Record<string, Statistic>;
  bucket?: HistoryBucket;
  diskIOPartial?: boolean;
};
export type MetricHistory = { period_seconds: number; points: HistoryPoint[]; typed?: boolean };
export const rangeSeconds: Record<HistoryRange, number> = {
  '1h': 3600,
  '6h': 21600,
  '24h': 86400,
  '2d': 172800,
  '7d': 604800,
};
export async function getMetricHistory(
  id: string,
  range: HistoryRange,
  signal?: AbortSignal,
): Promise<MetricHistory> {
  const v = await apiRequest<unknown>(`/nodes/${encodeURIComponent(id)}/metrics/history`, {
    signal,
    query: { range },
  });
  const parsed = parseHistoryResponse(v);
  if (!parsed) throw new ApiError('历史指标格式无效，请刷新重试。', 'invalid-response');
  return parsed;
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
