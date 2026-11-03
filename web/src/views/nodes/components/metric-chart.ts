import { diskHistoryKey } from '@/api/history-wire';
import type { HistoryPoint, MetricHistory } from '@/api/metric-history';
import { bytes } from '@/api/monitoring';

export type ChartSeries = { key: string; label: string; color: string; dash?: string };
export type MetricChart = {
  key: string;
  label: string;
  unit: '%' | 'bps' | 'B/s' | '个' | '';
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
      key: 'cpu',
      label: 'CPU',
      unit: '%',
      series: [series('cpu', '使用率')],
      value: '未知',
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
      key: 'connections',
      label: '连接数',
      unit: '个',
      series: [series('tcp_sockets', 'TCP'), series('udp_sockets', 'UDP', '5 3')],
      value: '未知 / 未知',
      detail: '',
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

// Typed history stores device peaks independently; layered devices must not be summed.
export function historyMetricCharts(charts: MetricChart[], data?: MetricHistory): MetricChart[] {
  if (!data?.typed) return charts;
  const devices = [
    ...new Set(data.points.flatMap((p) => p.bucket?.disk_io.map((d) => d.device) ?? [])),
  ].sort();
  return [
    ...charts
      .filter((chart) => chart.key !== 'disk_io')
      .map((chart) =>
        chart.key === 'disk'
          ? {
              ...chart,
              label: '文件系统使用率',
              series: [
                {
                  key: 'disk',
                  label: '本地文件系统合计（不含保留空间）',
                  color: 'var(--metric-disk)',
                },
              ],
              value: '历史最新值',
              detail: '不同口径分线显示，混合口径桶保留缺口',
            }
          : chart,
      ),
    ...devices.map(
      (device): MetricChart => ({
        key: `disk_io:${device}`,
        label: `磁盘 IO ${device}`,
        unit: 'B/s',
        series: [
          {
            key: diskHistoryKey(device, 'read_speed'),
            label: '读取',
            color: 'var(--metric-disk_read)',
          },
          {
            key: diskHistoryKey(device, 'write_speed'),
            label: '写入',
            color: 'var(--metric-disk_write)',
            dash: '5 3',
          },
        ],
        value: '历史采样峰值',
        detail: '按设备统计，分层设备不相加',
      }),
    ),
  ];
}
