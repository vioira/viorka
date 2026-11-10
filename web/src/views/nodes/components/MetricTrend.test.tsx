import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { MetricHistory } from '@/api/metric-history';
import type { LivePoint } from '@/api/realtime';
import { gapCurve, gapPaths, streamCurve } from '@/components/arc/line-chart/line-chart';
import MetricTrend from './MetricTrend';
import { metricCharts } from './metric-chart';

const chart = metricCharts().find((item) => item.key === 'cpu');
if (!chart) throw new Error('CPU chart is missing');
const data: MetricHistory = {
  period_seconds: 60,
  points: [
    {
      at: '2026-10-31T00:00:00Z',
      last_sample_at: '2026-10-31T00:00:00Z',
      stats: { cpu: { sum: 20, max: 20, count: 1 } },
    },
    {
      at: '2026-10-31T00:01:00Z',
      last_sample_at: '2026-10-31T00:01:00Z',
      stats: { cpu: { sum: 30, max: 30, count: 1 } },
    },
  ],
};

it('dims existing history while the next request is pending', () => {
  const html = renderToStaticMarkup(<MetricTrend chart={chart} data={data} loading />);
  expect(html).toContain('data-loading="true"');
  expect(html).toContain('采样平均值');
  expect(html).toContain('<table>');
});

it('retains the initial loading state before history has been read', () => {
  const html = renderToStaticMarkup(<MetricTrend chart={chart} loading />);
  expect(html).toContain('data-loading="true"');
  expect(html).not.toContain('<table>');
});

it('shows unknown readings across the full history window instead of zero', () => {
  const html = renderToStaticMarkup(
    <MetricTrend
      chart={chart}
      data={data}
      loading={false}
      window={{
        start: Date.parse('2026-10-30T23:59:00Z'),
        end: Date.parse('2026-10-31T00:03:00Z'),
      }}
    />,
  );
  expect(html).toContain('无采样');
  expect(html).not.toContain('显示时段：');
  expect(html).toContain('<td>20%</td>');
  expect(html).toContain('<td>30%</td>');
  expect(html).not.toContain('<td>0%</td>');
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

it('shows sampled peaks and aggregation ranges without changing the mean data', () => {
  const history = {
    period_seconds: 30,
    points: [{ ...data.points[0], stats: { cpu: { sum: 100, count: 10, max: 90 } } }],
  };
  const peak = renderToStaticMarkup(
    <MetricTrend chart={chart} data={history} loading={false} statistic="max" />,
  );
  const mean = renderToStaticMarkup(<MetricTrend chart={chart} data={history} loading={false} />);
  expect(peak).toContain('<td>90%</td>');
  expect(mean).toContain('<td>10%</td>');
  expect(peak).toContain('聚合时段');
  expect(peak).toContain('（采样峰值）');
});

it('labels typed means, peaks and latest values independently of the legacy selector', () => {
  for (const [kind, label] of [
    ['mean', '采样平均值'],
    ['peak', '采样峰值'],
    ['latest', '最新值'],
  ] as const) {
    const data = {
      period_seconds: 30,
      typed: true,
      points: [
        {
          at: '2026-10-31T00:00:00Z',
          last_sample_at: '2026-10-31T00:00:01Z',
          stats: { cpu: { sum: 40, max: 20, count: 2, kind } },
        },
      ],
    };
    const html = renderToStaticMarkup(
      <MetricTrend chart={metricCharts()[3]} data={data} loading={false} statistic="max" />,
    );
    expect(html).toContain(`CPU${label}`);
    expect(html).toContain('<td>20%</td>');
  }
});

it('renders full-group real-time samples instead of an empty chart', () => {
  const at = '2026-11-03T00:00:00Z';
  const livePoints: LivePoint[] = [
    {
      sequence: 1,
      at,
      received_at: at,
      group: 'full' as const,
      values: { load_one: 0, disk: 15, processes: 17 },
    },
    {
      sequence: 2,
      at: '2026-11-03T00:00:02Z',
      received_at: at,
      group: 'fast' as const,
      values: { cpu: 10 },
    },
  ];
  for (const [key, value] of [
    ['load', '0'],
    ['disk', '15%'],
    ['processes', '17个'],
  ]) {
    const fullChart = metricCharts().find((c) => c.key === key);
    if (!fullChart) throw new Error('missing chart');
    const html = renderToStaticMarkup(
      <MetricTrend chart={fullChart} livePoints={livePoints} loading={false} />,
    );
    expect(html).not.toContain('有效数据点：');
    expect(html).toContain(`<td>${value}</td>`);
    expect(html).not.toContain('等待有效采样');
  }
});

it('renders node IO zero rates and marks partial observations without device labels', () => {
  const disk = metricCharts().find((c) => c.key === 'disk_io');
  if (!disk) throw new Error('disk chart missing');
  const at = '2026-11-03T00:00:00Z';
  const html = renderToStaticMarkup(
    <MetricTrend
      chart={disk}
      loading={false}
      livePoints={[
        {
          sequence: 1,
          at,
          received_at: at,
          group: 'full',
          values: { disk_read: 0, disk_write: 1024, disk_io_partial: 1 },
        },
      ]}
    />,
  );
  expect(html).toContain('部分数据');
  expect(html).toContain('0 B/s');
  expect(html).not.toContain('磁盘 IO 设备');
});

it('labels slow history with the actual three minute interval and latest value', () => {
  const disk = metricCharts().find((item) => item.key === 'disk');
  if (!disk) throw new Error('Disk chart missing');
  const history: MetricHistory = {
    typed: true,
    period_seconds: 30,
    points: [
      {
        at: '2026-10-31T00:00:00Z',
        last_sample_at: '2026-10-31T00:00:00Z',
        stats: { disk: { sum: 20, max: 20, count: 1, kind: 'latest' } },
      },
      {
        at: '2026-10-31T00:01:00Z',
        last_sample_at: '2026-10-31T00:01:00Z',
        stats: { disk: { sum: 25, max: 25, count: 1, kind: 'latest' } },
      },
    ],
  };
  const html = renderToStaticMarkup(<MetricTrend chart={disk} data={history} loading={false} />);
  expect(html).not.toContain('按 3 分钟汇总');
  expect(html).toContain('最新值');
  expect(html).toContain('<td>25%</td>');
  expect(html).not.toContain('<td>20%</td>');
});

it('places streaming samples by elapsed time and preserves gaps', () => {
  const points = streamCurve(gapCurve([10, null, 30], false), [0, 1000, 10000], 10000);
  expect(points[0][0]).toBeCloseTo(1 - 10000 / 600000);
  const gap = points.find((point) => Number.isNaN(point[1]));
  expect(gap?.[0]).toBeCloseTo(1 - 9000 / 600000);
  expect(points.at(-1)).toEqual([1, 30]);
});

it('keeps existing streaming samples stationary before the viewport scroll begins', () => {
  const before = streamCurve(gapCurve([10, 20], false), [0, 10000], 10000);
  const after = streamCurve(gapCurve([10, 20, 30], false), [0, 10000, 20000], 20000);
  const offset = 10000 / 600000;
  expect(after[0][0] + offset).toBeCloseTo(before[0][0]);
  expect(after[1][0] + offset).toBeCloseTo(before[1][0]);
  expect(after[2][0] + offset).toBeGreaterThan(1);
});

it('does not stretch a lone streaming sample across the time window', () => {
  expect(streamCurve(gapCurve([12], true), [10000], 10000)).toEqual([
    [1, 12],
    [1, 12],
  ]);
});
