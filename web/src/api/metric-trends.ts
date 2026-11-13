import { ApiError, apiRequest } from './client';
import type { HistoryRange } from './metric-history';

export type MetricTrendPoint = {
  id: string;
  at: string;
  source: 'history' | 'live';
  values: Record<string, number | null>;
  partial?: boolean;
};
export type MetricTrend = {
  reset: boolean;
  period_seconds: number;
  statistic: 'mean' | 'peak' | 'latest';
  points: MetricTrendPoint[];
  removed_ids: string[];
};
export type MetricTrends = Record<string, MetricTrend>;
export type MetricTrendHistory = { start: string; end: string; charts: MetricTrends };
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const chartKeys = [
  'cpu',
  'memory',
  'network',
  'connections',
  'load',
  'disk',
  'disk_io',
  'processes',
];
export function isMetricTrends(v: unknown): v is MetricTrends {
  if (!record(v) || Object.keys(v).some((key) => !chartKeys.includes(key))) return false;
  return Object.values(v).every(
    (trend) =>
      record(trend) &&
      typeof trend.reset === 'boolean' &&
      Number.isInteger(trend.period_seconds) &&
      Number(trend.period_seconds) > 0 &&
      ['mean', 'peak', 'latest'].includes(String(trend.statistic)) &&
      Array.isArray(trend.points) &&
      trend.points.length <= 120 &&
      Array.isArray(trend.removed_ids) &&
      trend.removed_ids.length <= 120 &&
      trend.removed_ids.every((id) => typeof id === 'string') &&
      trend.points.every(
        (point) =>
          record(point) &&
          typeof point.id === 'string' &&
          date(point.at) &&
          ['history', 'live'].includes(String(point.source)) &&
          (point.partial === undefined || typeof point.partial === 'boolean') &&
          record(point.values) &&
          Object.keys(point.values).length <= 3 &&
          Object.values(point.values).every(
            (value) =>
              value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0),
          ),
      ),
  );
}
export async function getMetricTrends(
  id: string,
  range: HistoryRange,
  signal?: AbortSignal,
): Promise<MetricTrendHistory> {
  const value = await apiRequest<unknown>(`/nodes/${encodeURIComponent(id)}/metrics/trends`, {
    signal,
    query: { range },
  });
  if (!record(value) || !date(value.start) || !date(value.end) || !isMetricTrends(value.charts)) {
    throw new ApiError('指标趋势格式无效，请刷新重试。', 'invalid-response');
  }
  return value as MetricTrendHistory;
}

// Apply the server's window edits. Retention, resampling and gap detection belong to Panel.
export function mergeMetricTrends(
  previous: MetricTrends | undefined,
  incoming: MetricTrends,
): MetricTrends {
  const next = { ...previous };
  for (const [key, trend] of Object.entries(incoming)) {
    if (
      previous?.[key] &&
      !trend.reset &&
      trend.points.length === 0 &&
      trend.removed_ids.length === 0
    )
      continue;
    next[key] = {
      ...trend,
      points: trend.reset
        ? trend.points
        : [
            ...(previous?.[key]?.points ?? []).filter(
              (point) =>
                !trend.removed_ids.includes(point.id) &&
                !trend.points.some((p) => p.id === point.id),
            ),
            ...trend.points,
          ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)),
    };
  }
  return next;
}
