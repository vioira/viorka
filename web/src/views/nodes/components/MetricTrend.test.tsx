import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { MetricHistory } from '@/api/metric-history';
import { gapCurve, gapPaths } from '@/components/arc/line-chart/line-chart';
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

it('keeps existing history at full opacity during background refresh', () => {
  const html = renderToStaticMarkup(<MetricTrend chart={chart} data={data} loading />);
  expect(html).not.toContain('data-loading="true"');
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
  expect(html).toContain('缺失采样处断线');
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
