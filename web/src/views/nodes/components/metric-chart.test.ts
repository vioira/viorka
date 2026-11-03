import { expect, it } from 'vitest';
import type { MetricHistory } from '@/api/metric-history';
import { availableChartData, bitsPerSecond, historyChartData, metricCharts } from './metric-chart';

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
it('fills missing time buckets and retains both recorded runs', () => {
  const result = historyChartData(
    history(
      point(0, { memory: 10, swap: 0 }),
      point(2, { memory: 20, swap: 0 }),
      point(3, { memory: 25, swap: 0 }),
    ),
    series,
  );
  expect(result.points.map((p) => p.at)).toEqual([0, 1, 2, 3].map((n) => point(n, {}).at));
  expect(result.points[1].stats).toEqual({});
  expect(result.series.map((s) => s.key)).toEqual(['memory', 'swap']);
});
it('preserves each metric independently when another metric is missing', () => {
  const result = historyChartData(
    history(
      point(0, { memory: 10, swap: 0 }),
      point(1, { memory: 12 }),
      point(2, { memory: 15, swap: 1 }),
    ),
    series,
  );
  expect(result.points).toHaveLength(3);
  expect(result.points[1].stats.memory.sum).toBe(12);
  expect(result.points[1].stats.swap).toBeUndefined();
});
it('omits an unavailable series without treating a genuine zero as missing', () => {
  const result = historyChartData(
    history(point(0, { memory: 0 }), point(1, { memory: 0 })),
    series,
  );
  expect(result.series.map((s) => s.key)).toEqual(['memory']);
  expect(result.points).toHaveLength(2);
  expect(historyChartData(undefined, series).points).toEqual([]);
});
it('converts byte rates to decimal bit rates and leaves unknown values unknown', () => {
  expect(bitsPerSecond(125000)).toBe('1 Mbps');
  expect(bitsPerSecond(0)).toBe('0 bps');
  expect(bitsPerSecond()).toBe('未知');
  expect(metricCharts().find((chart) => chart.key === 'network')?.value).toBe('未知 / 未知');
});

it('shows all existing live samples regardless of gaps or irregular cadence', () => {
  const data = history(
    point(0, { memory: 0 }),
    point(0.037, { memory: 12 }),
    point(3, { memory: 20 }),
  );
  expect(availableChartData(data, series).points).toEqual(data.points);
  expect(availableChartData(data, series).series.map((item) => item.key)).toEqual(['memory']);
});
it('does not feed missing live values to Arc as zeros', () => {
  const data = history(
    point(0, { memory: 10, swap: 0 }),
    point(1, { memory: 12 }),
    point(2, { memory: 15, swap: 1 }),
  );
  const result = availableChartData(data, series);
  expect(result.points).toEqual(data.points);
  expect(result.points[1].stats.swap).toBeUndefined();
  expect(result.series.map((item) => item.key)).toEqual(['memory', 'swap']);
  expect(availableChartData(undefined, series).points).toEqual([]);
  expect(availableChartData(history(point(0, {})), series).series).toEqual([]);
});

it('pads the full selected window before and after samples, including empty history', () => {
  const window = { start: 30_000, end: 300_000 };
  const result = historyChartData(history(point(2, { memory: 0 })), series, window);
  expect(result.points).toHaveLength(6);
  expect(result.points.map((p) => p.stats.memory?.sum)).toEqual([
    undefined,
    undefined,
    0,
    undefined,
    undefined,
    undefined,
  ]);
  expect(historyChartData(history(), series, window).points).toHaveLength(6);
});
