import { expect, it } from 'vitest';
import type { MetricHistory } from '@/api/metric-history';
import type { LivePoint } from '@/api/realtime';
import {
  availableChartData,
  bitsPerSecond,
  historyChartData,
  historyForChart,
  metricCharts,
  mixedLiveChartData,
} from './metric-chart';

const memoryChart = metricCharts().find((chart) => chart.key === 'memory');
if (!memoryChart) throw new Error('Memory chart missing');
const series = memoryChart.series;
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

const diskChart = metricCharts().find((chart) => chart.key === 'disk');
if (!diskChart) throw new Error('Disk chart missing');
it('aggregates slow history without inventing samples or changing source data', () => {
  const source: MetricHistory = {
    typed: true,
    period_seconds: 30,
    points: [
      point(0, { disk: 24 }),
      point(0.5, { cpu: 2 }),
      point(1, { disk: 25 }),
      point(2, { disk: 26 }),
      point(3, { disk: 27 }),
      point(4, { disk: 28 }),
      point(9, { disk: 0 }),
    ],
  };
  for (const p of source.points) if (p.stats.disk) p.stats.disk.kind = 'latest';
  const original = JSON.stringify(source);
  const result = historyForChart(source, diskChart);
  expect(result?.period_seconds).toBe(180);
  const displayed = historyChartData(result, diskChart.series, { start: 0, end: 540000 });
  expect(displayed.points.map((p) => p.stats.disk?.sum)).toEqual([26, 28, undefined, 0]);
  expect(JSON.stringify(source)).toBe(original);
});
it('retains slow metric peaks independently and leaves absent series unknown', () => {
  const chart = {
    ...diskChart,
    key: 'disk_io',
    series: [
      { key: 'disk_read', label: 'read', color: '' },
      { key: 'disk_write', label: 'write', color: '' },
    ],
  };
  const source: MetricHistory = {
    typed: true,
    period_seconds: 30,
    points: [
      point(0, { disk_read: 100 }),
      point(1, { disk_read: 10 }),
      point(3, { disk_write: 0 }),
    ],
  };
  for (const p of source.points) for (const stat of Object.values(p.stats)) stat.kind = 'peak';
  const result = historyForChart(source, chart);
  if (!result) throw new Error('History missing');
  expect(result.points[0].stats.disk_read.sum).toBe(100);
  expect(result.points[0].stats.disk_write).toBeUndefined();
  expect(result.points[1].stats.disk_read).toBeUndefined();
  expect(result.points[1].stats.disk_write.sum).toBe(0);
});
it('preserves fast charts and already coarse history', () => {
  const source: MetricHistory = {
    typed: true,
    period_seconds: 30,
    points: [point(0, { cpu: 10 })],
  };
  expect(historyForChart(source, { ...diskChart, key: 'cpu' })).toBe(source);
  const coarse = { ...source, period_seconds: 180 };
  expect(historyForChart(coarse, diskChart)).toBe(coarse);
  expect(historyForChart(undefined, diskChart)).toBeUndefined();
});

it('uses server history unchanged and replaces only the sampled group bucket with raw points', () => {
  const source: MetricHistory = {
    period_seconds: 30,
    typed: true,
    points: [
      point(0, { memory: 99 }),
      point(0.5, { memory: 20 }),
      point(1, { memory: 30 }),
      point(1.5, { memory: 40 }),
    ],
  };
  source.points[1].stats.memory.kind = 'mean';
  const raw: LivePoint[] = [
    {
      group: 'full' as const,
      sequence: 1,
      at: point(0.6, {}).at,
      received_at: point(0.6, {}).at,
      values: { disk: 50 },
    },
    {
      group: 'fast' as const,
      sequence: 2,
      at: point(1.1, {}).at,
      received_at: point(1.1, {}).at,
      values: { memory: 31 },
    },
    {
      group: 'fast' as const,
      sequence: 3,
      at: point(1.2, {}).at,
      received_at: point(1.2, {}).at,
      values: { memory: 0 },
    },
  ];
  const result = mixedLiveChartData(source, raw, memoryChart, 600_000);
  expect(result.points[0].stats).toBe(source.points[1].stats);
  expect(result.points.filter((p) => p.stats.memory).map((p) => p.stats.memory.sum)).toEqual([
    20, 31, 0, 40,
  ]);
  expect(result.points.filter((p) => p.source === 'live').map((p) => p.at)).toEqual(
    raw.slice(1).map((p) => p.at),
  );
  expect(result.points.find((p) => p.at === point(2, {}).at)?.stats).toEqual({});
  expect(mixedLiveChartData(source, raw, memoryChart, 720_000).series).toEqual([]);
});

it('keeps slow historical points at the server 30-second resolution in the live view', () => {
  const source: MetricHistory = {
    period_seconds: 30,
    typed: true,
    points: [point(0.5, { disk: 24 }), point(1, { disk: 25 })],
  };
  const result = mixedLiveChartData(source, [], diskChart, 90_000);
  expect(result.points.filter((p) => p.stats.disk).map((p) => p.stats.disk.sum)).toEqual([24, 25]);
});

it('does not replace unavailable raw observations with historical values', () => {
  const source: MetricHistory = {
    period_seconds: 30,
    typed: true,
    points: [point(0.5, { memory: 20 }), point(1, { memory: 30 })],
  };
  const at = point(1.1, {}).at;
  const result = mixedLiveChartData(
    source,
    [{ sequence: 1, at, received_at: at, values: {} }],
    memoryChart,
    70_000,
  );
  expect(result.points.find((p) => p.at === at)?.stats).toEqual({});
  expect(result.points.some((p) => p.stats.memory?.sum === 30)).toBe(false);
});

it('connects slow history and raw observations without inserting fast-only or empty grid ticks', () => {
  for (const chart of metricCharts().filter((c) =>
    ['load', 'disk', 'disk_io', 'processes'].includes(c.key),
  )) {
    const metric = chart.series[0].key;
    const source: MetricHistory = {
      period_seconds: 30,
      typed: true,
      points: [
        point(0, { [metric]: 10 }),
        point(0.5, { cpu: 2 }),
        point(1, { [metric]: 20 }),
        point(1.5, { cpu: 3 }),
      ],
    };
    const raw: LivePoint[] = [2, 3, 4].map((minute, i) => ({
      group: 'full',
      sequence: i + 1,
      at: point(minute, {}).at,
      received_at: point(minute, {}).at,
      values: { [metric]: i + 30 },
    }));
    const result = mixedLiveChartData(source, raw, chart, 270_000);
    expect(result.points.map((p) => p.stats[metric]?.sum)).toEqual([10, 20, 30, 31, 32]);
    expect(result.points.map((p) => p.at)).toEqual([0, 1, 2, 3, 4].map((n) => point(n, {}).at));
  }
});

it('preserves failed full observations and breaks across prolonged full sampling outages', () => {
  const raw: LivePoint[] = [0, 1, 2, 6].map(
    (minute, i): LivePoint => ({
      group: 'full',
      sequence: i + 1,
      at: point(minute, {}).at,
      received_at: point(minute, {}).at,
      values: i === 1 ? {} : { disk: 20 },
    }),
  );
  const result = mixedLiveChartData({ period_seconds: 30, points: [] }, raw, diskChart, 390_000);
  expect(result.points.map((p) => p.stats.disk?.sum)).toEqual([20, undefined, 20, undefined, 20]);
  expect(result.points.map((p) => p.at)).toEqual([0, 1, 2, 5, 6].map((n) => point(n, {}).at));
});
