import type { HistoryPoint, MetricHistory } from '@/api/metric-history';
import { bytes, type HostMetrics } from '@/api/monitoring';

export type ChartSeries = { key: string; label: string; color: string; dash?: string };
export type MetricChart = {
  key: string;
  label: string;
  unit: '%' | 'bps' | '';
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
function networkTotal(
  m: HostMetrics | undefined,
  key: 'rx_bytes' | 'tx_bytes' | 'rx_bytes_per_second' | 'tx_bytes_per_second',
) {
  if (
    !m ||
    m.errors.includes('network_unavailable') ||
    m.errors.includes('unsupported_platform') ||
    !m.interfaces.length ||
    m.interfaces.some((i) => i[key] === undefined)
  )
    return undefined;
  return m.interfaces.reduce((total, i) => total + (i[key] ?? 0), 0);
}
export function metricCharts(m?: HostMetrics): MetricChart[] {
  return [
    {
      key: 'memory',
      label: '内存',
      unit: '%',
      series: [series('memory', '内存'), series('swap', 'Swap', '5 3')],
      value: `${bytes(m?.memory?.used_bytes)} / ${bytes(m?.memory?.total_bytes)}`,
      detail: `Swap ${bytes(m?.memory?.swap_used_bytes)} / ${bytes(m?.memory?.swap_total_bytes)}`,
    },
    {
      key: 'network',
      label: '网络',
      unit: 'bps',
      series: [series('rx', '下行'), series('tx', '上行', '5 3')],
      value: `${bitsPerSecond(networkTotal(m, 'rx_bytes_per_second'))} / ${bitsPerSecond(networkTotal(m, 'tx_bytes_per_second'))}`,
      detail: `↓ ${bytes(networkTotal(m, 'rx_bytes'))}　↑ ${bytes(networkTotal(m, 'tx_bytes'))}`,
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
      value: m?.load
        ? [m.load.one, m.load.five, m.load.fifteen].map((n) => n.toFixed(2)).join(' / ')
        : '未知 / 未知 / 未知',
      detail: m?.cpu ? `${m.cpu.logical_cpus} 个逻辑 CPU` : 'CPU 数量未知',
    },
    {
      key: 'cpu',
      label: 'CPU',
      unit: '%',
      series: [series('cpu', '使用率')],
      value: m?.cpu?.usage_percent === undefined ? '未知' : `${m.cpu.usage_percent.toFixed(1)}%`,
      detail: m?.cpu ? `${m.cpu.logical_cpus} 个逻辑 CPU` : '等待有效采样',
    },
    {
      key: 'disk',
      label: '磁盘',
      unit: '%',
      series: [series('disk', '使用率')],
      value: `${bytes(m?.disk?.used_bytes)} / ${bytes(m?.disk?.total_bytes)}`,
      detail: `可用 ${bytes(m?.disk?.available_bytes)}`,
    },
  ];
}

// Arc spaces points evenly and substitutes zero for missing values. Supply only
// the newest contiguous run whose selected series are all present.
export function continuousChartData(data: MetricHistory | undefined, series: ChartSeries[]) {
  const points = data?.points ?? [];
  let last = points.length - 1;
  while (last >= 0 && !series.some((item) => points[last].stats[item.key])) last--;
  if (last < 0) return { points: [] as HistoryPoint[], series: [] as ChartSeries[] };
  const available = series.filter((item) => points[last].stats[item.key]);
  const run: HistoryPoint[] = [];
  for (let i = last; i >= 0; i--) {
    const point = points[i];
    if (
      available.some((item) => !point.stats[item.key]) ||
      (run.length &&
        Date.parse(run[0].at) - Date.parse(point.at) !== (data?.period_seconds ?? 60) * 1000)
    )
      break;
    run.unshift(point);
  }
  return { points: run, series: available };
}
