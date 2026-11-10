import type { HistoryPoint, MetricHistory } from '@/api/metric-history';
import { bytes } from '@/api/monitoring';
import type { LivePoint } from '@/api/realtime';

export type ChartSeries = { key: string; label: string; color: string; dash?: string };
export type MetricChart = {
  key: string;
  label: string;
  unit: '%' | 'bps' | 'B/s' | '个' | 'ms' | 'IOPS' | '';
  series: ChartSeries[];
  value: string;
  detail: string;
};
const series = (key: string, label: string, dash?: string): ChartSeries => ({
  key,
  label,
  color: `var(--metric-${key})`,
  dash,
});
export function bitsPerSecond(bytesPerSecond?: number) {
  if (bytesPerSecond === undefined) return '未知';
  const bits = bytesPerSecond * 8;
  const units = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps'];
  const index = Math.min(4, Math.max(0, Math.floor(Math.log10(Math.max(1, bits)) / 3)));
  return `${Number((bits / 1000 ** index).toFixed(2))} ${units[index]}`;
}
export const byteRate = (value?: number) => (value === undefined ? '未知' : `${bytes(value)}/s`);

export function metricCharts(): MetricChart[] {
  return [
    {
      key: 'cpu',
      label: 'CPU',
      unit: '%',
      series: [series('cpu', '使用率')],
      value: '未知',
      detail: '',
    },
    {
      key: 'memory',
      label: '内存',
      unit: '%',
      series: [series('memory', '内存'), series('swap', 'Swap', '5 3')],
      value: '未知 / 未知',
      detail: '',
    },
    {
      key: 'network',
      label: '网络',
      unit: 'bps',
      series: [series('rx', '下行'), series('tx', '上行', '5 3')],
      value: '未知 / 未知',
      detail: '',
    },
    {
      key: 'load',
      label: '负载',
      unit: '',
      series: [
        series('load_one', '1 分钟'),
        series('load_five', '5 分钟', '5 3'),
        series('load_fifteen', '15 分钟', '2 3'),
      ],
      value: '未知',
      detail: '',
    },
    {
      key: 'connections',
      label: '连接数',
      unit: '个',
      series: [series('tcp_sockets', 'TCP'), series('udp_sockets', 'UDP', '5 3')],
      value: '未知 / 未知',
      detail: '',
    },
    {
      key: 'disk',
      label: '文件系统容量',
      unit: '%',
      series: [series('disk', '使用率')],
      value: '未知',
      detail: '',
    },
    {
      key: 'disk_io',
      label: '磁盘 IO',
      unit: 'B/s',
      value: '未知',
      detail: '',
      series: [
        { key: 'disk_read', label: '读取', color: 'var(--metric-disk_read)' },
        { key: 'disk_write', label: '写入', color: 'var(--metric-disk_write)', dash: '5 3' },
      ],
    },
    {
      key: 'disk_io_iops',
      label: '磁盘 IOPS',
      unit: 'IOPS',
      value: '未知',
      detail: '',
      series: [
        { key: 'disk_read_iops', label: '读取', color: 'var(--metric-disk_read)' },
        { key: 'disk_write_iops', label: '写入', color: 'var(--metric-disk_write)', dash: '5 3' },
      ],
    },
    {
      key: 'disk_io_await',
      label: '磁盘等待时间',
      unit: 'ms',
      value: '未知',
      detail: '',
      series: [{ key: 'disk_await_ms', label: '加权等待时间', color: 'var(--metric-disk_read)' }],
    },
    {
      key: 'disk_io_util',
      label: '最高磁盘利用率',
      unit: '%',
      value: '未知',
      detail: '',
      series: [{ key: 'disk_util_percent', label: '最高利用率', color: 'var(--metric-disk_read)' }],
    },
    {
      key: 'processes',
      label: '进程数',
      unit: '个',
      series: [series('processes', '进程数')],
      value: '未知',
      detail: '',
    },
  ];
}

// Full samples can be 30–180 seconds apart. Historical buckets do not retain
// group timestamps/errors, so aggregate rather than guessing which nulls to bridge.
export function historyForChart(data: MetricHistory | undefined, chart: MetricChart) {
  if (
    !data?.typed ||
    data.period_seconds >= 180 ||
    !(['load', 'disk', 'processes'].includes(chart.key) || chart.key.startsWith('disk_io'))
  ) {
    return data;
  }
  const buckets = new Map<number, HistoryPoint>();
  for (const point of [...data.points].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    const start = Math.floor(Date.parse(point.at) / 180_000) * 180_000;
    let bucket = buckets.get(start);
    if (!bucket) {
      bucket = {
        at: new Date(start).toISOString(),
        last_sample_at: point.last_sample_at,
        stats: {},
      };
      buckets.set(start, bucket);
    }
    bucket.last_sample_at = point.last_sample_at;
    for (const { key } of chart.series) {
      const stat = point.stats[key];
      if (!stat || stat.count <= 0) continue;
      const previous = bucket.stats[key];
      if (stat.kind === 'peak') {
        const value = Math.max(previous?.max ?? -Infinity, stat.max);
        bucket.stats[key] = { sum: value, max: value, count: 1, kind: 'peak' };
      } else {
        bucket.stats[key] = { ...stat };
      }
    }
  }
  return { period_seconds: 180, typed: true, points: [...buckets.values()] };
}

// Fill the displayed bucket grid, preserving unknown values and every recorded run.
export function historyChartData(
  data: MetricHistory | undefined,
  series: ChartSeries[],
  window?: { start: number; end: number },
) {
  if (!data) return { points: [] as HistoryPoint[], series: [] as ChartSeries[] };
  const period = data.period_seconds * 1000;
  const start = window?.start ?? Date.parse(data.points[0]?.at ?? '');
  const end = window?.end ?? Date.parse(data.points.at(-1)?.at ?? '');
  const buckets = new Map(data.points.map((point) => [Date.parse(point.at), point]));
  const points: HistoryPoint[] = [];
  for (let at = Math.floor(start / period) * period; at <= end; at += period) {
    const time = new Date(at).toISOString();
    points.push(buckets.get(at) ?? { at: time, last_sample_at: time, stats: {} });
  }
  return {
    points,
    series: series.filter((item) => points.some((point) => point.stats[item.key])),
  };
}

// Preserve missing samples so the local gap-aware Arc chart breaks the line.
// Filtering them out would connect observations across an unknown value.
export function availableChartData(data: MetricHistory | undefined, series: ChartSeries[]) {
  const points = data?.points ?? [];
  const available = series.filter((item) =>
    points.some((point) => {
      const stat = point.stats[item.key];
      return stat && stat.count > 0 && Number.isFinite(stat.sum / stat.count);
    }),
  );
  return { points: available.length ? points : [], series: available };
}

// Disk I/O is aggregated on the Agent before temporal peaks are recorded.
export function historyMetricCharts(charts: MetricChart[], _data?: MetricHistory): MetricChart[] {
  if (!_data?.typed) return charts;
  return charts.map((chart) =>
    chart.key === 'disk'
      ? {
          ...chart,
          label: '文件系统使用率',
          detail: '本地文件系统合计，不含保留空间',
        }
      : chart,
  );
}

const fullMetricKeys = [
  'load_one',
  'load_five',
  'load_fifteen',
  'disk',
  'processes',
  'disk_read',
  'disk_write',
  'disk_read_iops',
  'disk_write_iops',
  'disk_await_ms',
  'disk_util_percent',
];
const isFullChart = (chart: MetricChart) =>
  ['load', 'disk', 'processes'].includes(chart.key) || chart.key.startsWith('disk_io');

// Each chart follows its sampling group. Unavailable observations within that
// group remain gaps; ticks belonging to the other group are not missing samples.
function rawChartData(points: LivePoint[], chart: MetricChart): MetricHistory {
  const group = isFullChart(chart) ? 'full' : 'fast';
  return {
    period_seconds: 1,
    points: points
      .filter((p) => (p.group ?? 'fast') === group)
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.sequence - b.sequence)
      .map((p) => ({
        at: p.at,
        last_sample_at: p.at,
        diskIOPartial: p.values.disk_io_partial === 1,
        stats: Object.fromEntries(
          Object.entries(p.values).map(([key, value]) => [
            key,
            { sum: value, max: value, count: 1 },
          ]),
        ),
      })),
  };
}

export function liveChartData(points: LivePoint[], chart: MetricChart) {
  return availableChartData(rawChartData(points, chart), chart.series);
}

// Use server aggregates unchanged. Raw samples replace the matching group's bucket.
export function mixedLiveChartData(
  history: MetricHistory | undefined,
  points: LivePoint[],
  chart: MetricChart,
  end: number,
) {
  const start = end - 600_000;
  const raw = rawChartData(points, chart).points.filter(
    (p) => Date.parse(p.at) > start && Date.parse(p.at) <= end,
  );
  const occupied = new Set(raw.map((p) => Math.floor(Date.parse(p.at) / 30_000)));
  // Fast-only buckets are not failed full observations. Do not insert a 30s
  // grid into a group that legitimately samples every 30–180s.
  const full = isFullChart(chart);
  const historyPoints = full
    ? (history?.points ?? []).filter((p) => fullMetricKeys.some((key) => p.stats[key]))
    : historyChartData(history, chart.series, { start, end }).points;
  const historical = historyPoints
    .filter(
      (p) =>
        Date.parse(p.at) > start &&
        Date.parse(p.at) <= end &&
        !occupied.has(Math.floor(Date.parse(p.at) / 30_000)),
    )
    .map((p) => ({ ...p, source: 'history' as const }));
  const merged: HistoryPoint[] = [
    ...historical,
    ...raw.map((p) => ({ ...p, source: 'live' as const })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  // Keep prolonged outages disconnected; allow one bucket of timestamp
  // quantization at the historical boundary. Explicit invalid raw points stay.
  const continuous: HistoryPoint[] = [];
  for (const point of merged) {
    const previous = continuous.at(-1);
    if (full && previous) {
      const allowance = previous.source === 'history' || point.source === 'history' ? 30_000 : 0;
      if (Date.parse(point.at) - Date.parse(previous.at) > 180_000 + allowance) {
        const at = new Date(Date.parse(previous.at) + 180_000 + allowance).toISOString();
        continuous.push({ at, last_sample_at: at, stats: {} });
      }
    }
    continuous.push(point);
  }
  return availableChartData({ period_seconds: 30, points: continuous }, chart.series);
}
