import { expect, it } from 'vitest';
import type { MetricHistory } from '@/api/metric-history';
import { bitsPerSecond, continuousChartData, metricCharts } from './metric-chart';

const series = metricCharts()[0].series;
const point = (minute: number, values: Record<string, number>) => ({
  at: new Date(minute * 60000).toISOString(),
  last_sample_at: new Date(minute * 60000).toISOString(),
  stats: Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, { sum: value, count: 1, max: value }]),
  ),
});
const history = (...points: MetricHistory['points']): MetricHistory => ({
  period_seconds: 60,
  points,
});
it('cuts at missing time buckets instead of connecting or zero-filling them', () => {
  const result = continuousChartData(
    history(
      point(0, { memory: 10, swap: 0 }),
      point(2, { memory: 20, swap: 0 }),
      point(3, { memory: 25, swap: 0 }),
    ),
    series,
  );
  expect(result.points.map((p) => p.at)).toEqual([point(2, {}).at, point(3, {}).at]);
  expect(result.series.map((s) => s.key)).toEqual(['memory', 'swap']);
});
it('cuts a multi-series run when one selected metric is missing', () => {
  const result = continuousChartData(
    history(
      point(0, { memory: 10, swap: 0 }),
      point(1, { memory: 12 }),
      point(2, { memory: 15, swap: 1 }),
    ),
    series,
  );
  expect(result.points).toHaveLength(1);
  expect(result.points[0].stats.swap.sum).toBe(1);
});
it('omits an unavailable series without treating a genuine zero as missing', () => {
  const result = continuousChartData(
    history(point(0, { memory: 0 }), point(1, { memory: 0 })),
    series,
  );
  expect(result.series.map((s) => s.key)).toEqual(['memory']);
  expect(result.points).toHaveLength(2);
  expect(continuousChartData(undefined, series).points).toEqual([]);
});
it('converts byte rates to decimal bit rates and leaves unknown values unknown', () => {
  expect(bitsPerSecond(125000)).toBe('1 Mbps');
  expect(bitsPerSecond(0)).toBe('0 bps');
  expect(bitsPerSecond()).toBe('未知');
  expect(metricCharts().find((chart) => chart.key === 'network')?.value).toBe('未知 / 未知');
});
