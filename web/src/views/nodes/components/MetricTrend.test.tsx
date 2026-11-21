import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { MetricTrend as TrendData } from '@/api/metric-trends';
import {
  gapCurve,
  gapPaths,
  streamAxisPicks,
  streamCurve,
  valueAt,
} from '@/components/arc/line-chart/line-chart';
import {
  positionInView,
  streamDurationMs,
  streamWindow,
} from '@/components/arc/line-chart/stream-window';
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

it.each([
  { realtime: true, peak: 0.038, ticks: ['0', '0.01', '0.02', '0.03', '0.04'] },
  { realtime: true, peak: 0, ticks: ['0', '0.0025', '0.005', '0.0075', '0.01'] },
  { realtime: false, peak: 0.006, ticks: ['0', '0.0025', '0.005', '0.0075', '0.01'] },
  { realtime: false, peak: 2.7, ticks: ['0', '1', '2', '3'] },
])('sets readable load ticks for a peak of $peak', ({ realtime, peak, ticks }) => {
  const load = metricCharts().find((item) => item.key === 'load');
  if (!load) throw new Error('missing load chart');
  const history: TrendData = {
    ...data,
    statistic: 'latest',
    points: data.points.map((point, index) => ({
      ...point,
      values: { load_one: index === 0 ? peak : 0, load_five: 0, load_fifteen: 0 },
    })),
  };
  const html = renderToStaticMarkup(
    <MetricTrend chart={load} data={history} loading={false} realtime={realtime} />,
  );
  expect([...new Set([...html.matchAll(/>([\d.]+)<\/span>/g)].map((match) => match[1]))]).toEqual(
    ticks,
  );
  expect(html).toContain(`<td>${peak}</td>`);
});

it('starts a realtime chart at the first nonempty history bucket and keeps later gaps', () => {
  const memory = metricCharts()[1];
  const history: TrendData = {
    ...data,
    points: [null, null, 0, null, 5, null].map((swap, i) => ({
      id: String(i),
      at: new Date(i * 60_000).toISOString(),
      source: i === 4 ? 'live' : 'history',
      values: { memory: null, swap },
    })),
  };
  const render = (realtime: boolean) =>
    renderToStaticMarkup(
      <MetricTrend chart={memory} data={history} loading={false} realtime={realtime} />,
    );

  const live = render(true);
  expect(live).toContain('aria-valuemax="4"');
  expect(live).toContain('<td>无采样</td><td>0%</td>');
  expect(live.match(/<td>无采样<\/td><td>无采样<\/td>/g)).toHaveLength(2);
  expect(render(false).match(/<td>无采样<\/td><td>无采样<\/td>/g)).toHaveLength(4);
  expect(history.points).toHaveLength(6);
});

it('waits for a sample when all realtime history buckets are empty', () => {
  const history = {
    ...data,
    points: data.points.map((point) => ({ ...point, values: { cpu: null } })),
  };
  const html = renderToStaticMarkup(
    <MetricTrend chart={chart} data={history} loading={false} realtime />,
  );
  expect(html).toContain('等待有效采样');
  expect(html).not.toContain('<table>');

  const livePoint = { ...data.points[2], id: 'live', source: 'live' as const };
  const live = renderToStaticMarkup(
    <MetricTrend
      chart={chart}
      data={{ ...history, points: [...history.points.slice(0, -1), livePoint] }}
      loading={false}
      realtime
    />,
  );
  expect(live).toContain('<td>30%</td>');
  expect(live).not.toContain('无采样');
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
    expect(html).not.toContain('data-loading="true"');
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

it('gives live sample positions the same spacing as history and gap positions', () => {
  const shape = gapCurve([10, 12, null, 20, 30], false);
  const points = streamCurve(shape, [0, 1, 2, 3, 4], 4);

  expect(points).toEqual([
    [0, 10],
    [0.25, 12],
    [0.5, Number.NaN],
    [0.75, 20],
    [1, 30],
  ]);
  expect(gapPaths(points, 400, 100, (value) => value).line).toBe(
    'M0.0,10.0L100.0,12.0M300.0,20.0L400.0,30.0',
  );
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

it('keeps tick identities through appends, evictions and batches with missing samples', () => {
  const samples = Array.from({ length: 22 }, (_, i) => ({
    key: `point-${i}`,
    label: String(i),
    axisLabel: '12:00:00',
    values: { cpu: i === 15 ? null : i },
  }));
  const select = (start: number, end: number, retained?: Set<string>, visibleStart = start) => {
    const data = samples.slice(visibleStart, end + 1);
    const coordinates = data.map((_, i) => i + visibleStart);
    return streamAxisPicks(data, coordinates, 352, { start, end }, retained, visibleStart).map(
      (i) => data[i].key,
    );
  };
  const initial = select(0, 12);
  expect(initial).toEqual(['point-0', 'point-3', 'point-6', 'point-9', 'point-12']);
  const retained = new Set(initial);
  expect(select(1, 13, retained, 0)).toEqual(initial);
  expect(select(1, 13, retained)).toEqual(initial.slice(1));
  expect(select(0, 13, retained)).toEqual(initial);
  expect(select(7, 19, retained)).toEqual(['point-9', 'point-12', 'point-16', 'point-19']);
  // A reset seeds from the new right edge, independent of the previous selection.
  expect(select(1, 13)).toEqual(['point-1', 'point-4', 'point-7', 'point-10', 'point-13']);
});

const reading = (n: number) => ({
  key: `s${n}`,
  label: String(n),
  timestamp: 10_000 + n ** 2,
  values: { cpu: n === 15 ? null : n },
});

it('paces the live stroke by the delivered samples and bounds catch-up after a gap', () => {
  const previous = { ...reading(0), timestamp: 20_000 };
  for (const [elapsed, duration] of [
    [1000, 1000],
    [3000, 3000],
    [60_000, 5000],
    [0, 1000],
  ]) {
    expect(streamDurationMs(previous, { ...reading(1), timestamp: 20_000 + elapsed })).toBe(
      duration,
    );
  }
});

it('draws the live tip on the visible stroke and hides it while crossing a sampling gap', () => {
  const shape = gapCurve([20, 40, null, 80, 60], false);
  expect(valueAt(shape, 0.125)).toBe(30);
  expect(valueAt(shape, 0.25)).toBe(40);
  for (const x of [0.375, 0.5, 0.625]) expect(valueAt(shape, x)).toBeNaN();
  expect(valueAt(shape, 0.75)).toBe(80);
  expect(valueAt(shape, 0.875)).toBe(70);
  expect(valueAt([], 1)).toBeNaN();
});

it.each(['sample', 'time'] as const)(
  'scrolls a full %s window from its displayed position',
  (spacing) => {
    const samples = Array.from({ length: 124 }, (_, i) => reading(i));
    const initial = streamWindow(samples.slice(0, 120), spacing);
    const next = streamWindow(samples.slice(1, 121), spacing, initial);
    expect(next.first).toBe(1);
    expect(next.view).toEqual(initial.target);
    expect(positionInView(next.coordinates[119], next.view)).toBe(1);
    expect(positionInView(next.coordinates[120], next.view)).toBeGreaterThan(1);
    expect(positionInView(next.coordinates[0], next.target)).toBeLessThan(0);
    expect(positionInView(next.coordinates[120], next.target)).toBe(1);

    next.view = {
      start: (next.view.start + next.target.start) / 2,
      end: (next.view.end + next.target.end) / 2,
    };
    const interrupted = streamWindow(samples.slice(4), spacing, next);
    expect(interrupted.view).toEqual(next.view);
    expect(interrupted.data[15].values.cpu).toBeNull();
    expect(positionInView(interrupted.coordinates[119], interrupted.view)).toEqual(
      positionInView(next.coordinates[119], next.view),
    );
    expect(interrupted.data.slice(interrupted.first)).toEqual(samples.slice(4));
  },
);

it('starts at a lone sample and snaps to replacements, expired windows and corrected samples', () => {
  const initial = streamWindow([reading(1)], 'time');
  const append = streamWindow([reading(1), reading(30)], 'time', initial);
  expect(positionInView(append.coordinates[0], append.view)).toBe(1);
  expect(positionInView(append.coordinates[0], append.target)).toBe(0);
  for (const samples of [
    [reading(30)],
    [reading(100), reading(101)],
    [reading(1), reading(2), reading(30), reading(31)],
    [reading(1), { ...reading(30), values: { cpu: null } }, reading(31)],
  ]) {
    const frame = streamWindow(samples, 'time', append);
    expect(frame.view).toBe(frame.target);
    expect(frame.data).toEqual(samples);
  }
});
