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

it('uses host rates and counts without inventing missing rates or process limits', () => {
  const live = {
    sampled_at: '2026-01-01T00:00:00Z',
    interval_seconds: 10,
    interfaces: [],
    errors: [],
    host: {
      disk_io: [
        {
          device: 'sda',
          read_bytes: 4096,
          write_bytes: 2048,
          read_bytes_per_second: 1024,
          write_bytes_per_second: 0,
        },
      ],
      processes: 0,
      tcp_sockets: 12,
      udp_sockets: 0,
      errors: [] as string[],
    },
  };
  const chart = (key: string) => metricCharts(live).find((c) => c.key === key);
  expect(chart('disk_io')?.value).toBe('1.0 KiB/s / 0 B/s');
  expect(chart('connections')?.value).toBe('12 / 0');
  expect(chart('processes')?.value).toBe('0');
  expect(chart('processes')?.detail).toBe('进程上限未采集');
  live.host.errors = ['disk_io_unavailable', 'sockets_unavailable', 'processes_unavailable'];
  expect(chart('disk_io')?.value).toBe('未知 / 未知');
  expect(chart('connections')?.value).toBe('未知 / 未知');
  expect(chart('processes')?.value).toBe('未知');
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
  expect(result.points).toEqual([data.points[0], data.points[2]]);
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
