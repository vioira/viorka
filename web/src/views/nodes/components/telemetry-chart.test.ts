import { expect, it } from 'vitest';
import type { TelemetrySnapshot } from '@/api/telemetry';
import { liveChartData, metricCharts } from './metric-chart';
import { telemetryChartPoints } from './telemetry-chart';

it('plots full samples at their own times and retains unavailable full gaps', () => {
  const point = (
    sequence: number,
    seconds: number,
    group: 'fast' | 'full',
    values: Record<string, number>,
  ) => ({
    sequence,
    sample_sequence: String(sequence),
    group,
    at: new Date(seconds * 1000).toISOString(),
    received_at: new Date(120000).toISOString(),
    values,
  });
  const snapshot = {
    points: [
      point(1, 2, 'fast', { cpu_percent: 10 }),
      point(2, 0, 'full', {
        load_1: 0,
        load_5: 1,
        load_15: 2,
        disk_percent: 51,
        processes: 17,
        disk_read: 0,
        disk_write: 1024,
        disk_read_iops: 0,
        disk_write_iops: 2,
        disk_await_ms: 4,
        disk_util_percent: 25,
        disk_io_partial: 1,
      }),
      point(3, 4, 'fast', {}),
      point(4, 60, 'full', {}),
      point(5, 120, 'full', { load_1: 2, disk_percent: 52, processes: 18 }),
    ],
  } as TelemetrySnapshot;
  const points = telemetryChartPoints(snapshot);
  for (const [key, valueKey, expected] of [
    ['load', 'load_one', 0],
    ['disk', 'disk', 51],
    ['processes', 'processes', 17],
    ['disk_io', 'disk_read', 0],
    ['disk_io_iops', 'disk_write_iops', 2],
    ['disk_io_await', 'disk_await_ms', 4],
    ['disk_io_util', 'disk_util_percent', 25],
  ] as const) {
    const chart = metricCharts().find((c) => c.key === key);
    if (!chart) throw new Error('chart missing');
    const data = liveChartData(points, chart);
    expect(data.points.map((p) => p.at)).toEqual(
      [0, 60, 120].map((s) => new Date(s * 1000).toISOString()),
    );
    expect(data.points[0].stats[valueKey].sum).toBe(expected);
    expect(data.points[1].stats[valueKey]).toBeUndefined();
  }
  const cpuChart = metricCharts().find((c) => c.key === 'cpu');
  if (!cpuChart) throw new Error('CPU chart missing');
  const cpu = liveChartData(points, cpuChart);
  expect(cpu.points).toHaveLength(2);
  expect(cpu.points[1].stats.cpu).toBeUndefined();
});
