import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { MetricTrend as TrendData } from '@/api/metric-trends';
import {
  gapCurve,
  gapPaths,
  streamAxisPicks,
  streamCurve,
} from '@/components/arc/line-chart/line-chart';
import MetricTrend from './MetricTrend';
import { metricCharts } from './metric-chart';

const chart = metricCharts()[0];
const data: TrendData = {
  reset: true,
  period_seconds: 60,
  statistic: 'mean',
  removed_ids: [],
  points: [20, null, 30].map((cpu, i) => ({
    id: String(i),
    at: new Date(i * 60000).toISOString(),
    source: 'history',
    values: { cpu },
  })),
};
it('renders server values and gaps without resampling or discarding points', () => {
  const html = renderToStaticMarkup(<MetricTrend chart={chart} data={data} loading={false} />);
  expect(html).toContain('<td>20%</td>');
  expect(html).toContain('<td>30%</td>');
  expect(html).toContain('无采样');
  expect(html).not.toContain('<td>0%</td>');
});
it('retains loading states and the server statistic', () => {
  expect(renderToStaticMarkup(<MetricTrend chart={chart} loading />)).not.toContain('<table>');
  for (const [statistic, label] of [
    ['mean', '采样平均值'],
    ['peak', '采样峰值'],
    ['latest', '最新值'],
  ] as const) {
    const html = renderToStaticMarkup(
      <MetricTrend chart={chart} data={{ ...data, statistic }} loading />,
    );
    expect(html).toContain('data-loading="true"');
    expect(html).toContain(label);
    expect(html).toContain('<td>20%</td>');
  }
});
it('labels historical and live points and preserves partial IO zero values', () => {
  const disk = metricCharts().find((c) => c.key === 'disk_io');
  if (!disk) throw new Error('missing disk chart');
  const html = renderToStaticMarkup(
    <MetricTrend
      chart={disk}
      realtime
      loading={false}
      data={{
        ...data,
        statistic: 'peak',
        points: data.points.map((p, i) => ({
          ...p,
          source: i === 0 ? 'history' : 'live',
          partial: true,
          values: { disk_read: 0, disk_write: 1024 },
        })),
      }}
    />,
  );
  expect(html).toContain('（峰值）');
  expect(html).toContain('（实时）');
  expect(html).toContain('部分数据');
  expect(html).toContain('0 B/s');
});
it('draws disconnected strokes and closes each filled run at its own boundaries', () => {
  const shape = gapCurve([null, 10, 20, null, 0, 30, null], false);
  const paths = gapPaths(shape, 600, 100, (value) => 100 - value);
  expect(paths.line).toBe('M100.0,90.0L200.0,80.0M400.0,100.0L500.0,70.0');
  expect(paths.area).toBe(
    'M100.0,90.0L200.0,80.0L200.0,100L100.0,100ZM400.0,100.0L500.0,70.0L500.0,100L400.0,100Z',
  );
  expect(gapPaths(gapCurve([null, null], true), 600, 100, (v) => v)).toEqual({
    line: '',
    area: '',
  });
  expect(gapPaths(gapCurve([null, 10, null], true), 600, 100, (v) => v).line).toBe(
    'M300.0,10.0L300.0,10.0',
  );
});

it('places streaming samples by elapsed time and preserves gaps', () => {
  const points = streamCurve(gapCurve([10, null, 30], false), [0, 1000, 10000], 10000);
  expect(points[0][0]).toBe(0);
  const gap = points.find((point) => Number.isNaN(point[1]));
  expect(gap?.[0]).toBeCloseTo(0.1);
  expect(points.at(-1)).toEqual([1, 30]);
});

it('fits the retained time span when adding and evicting samples', () => {
  const before = streamCurve(gapCurve([10, 20], false), [0, 2000], 2000);
  const after = streamCurve(gapCurve([10, 20, 30], false), [0, 2000, 4000], 4000);
  expect(before[0][0]).toBe(0);
  expect(after[0][0]).toBe(0);
  expect(after[1][0]).toBe(0.5);
  const retained = streamCurve(gapCurve([20, 30], false), [2000, 4000], 4000);
  expect(retained).toEqual([
    [0, 20],
    [1, 30],
  ]);
  expect(after.at(-1)).toEqual([1, 30]);
});

it('chooses actual sample timestamps for axis ticks without crowding or synthetic gap ticks', () => {
  const times = [0, 30_000, 60_000, 90_000, 300_000, 302_000, 304_000, 306_000];
  const data = times.map((time, i) => ({
    key: new Date(time).toISOString(),
    label: String(time),
    axisLabel: String(time),
    values: { cpu: i === 4 ? null : 10 },
  }));
  const picks = streamAxisPicks(data, times, 600);
  expect(picks).toEqual([1, 3, 7]);
  expect(picks.map((i) => data[i].axisLabel)).toEqual(['30000', '90000', '306000']);
  expect(streamAxisPicks(data, times, 0)).toEqual([]);
  expect(streamAxisPicks(data.slice(-1), times.slice(-1), 600)).toEqual([0]);
});

it('does not stretch a lone streaming sample across the time window', () => {
  expect(streamCurve(gapCurve([12], true), [10000], 10000)).toEqual([
    [1, 12],
    [1, 12],
  ]);
});
