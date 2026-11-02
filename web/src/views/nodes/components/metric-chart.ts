import type { HistoryPoint, MetricHistory } from '@/api/metric-history';
import { bytes, type HostMetrics } from '@/api/monitoring';

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
export function diskRate(
  m: HostMetrics | undefined,
  key: 'read_bytes_per_second' | 'write_bytes_per_second',
) {
  const h = m?.host;
  if (
    !h ||
    h.errors.includes('disk_io_unavailable') ||
    !h.disk_io.length ||
    h.disk_io.some((d) => d[key] === undefined)
  )
    return undefined;
  return h.disk_io.reduce((total, d) => total + (d[key] ?? 0), 0);
}
export const byteRate = (value?: number) => (value === undefined ? '未知' : `${bytes(value)}/s`);
function hostCount(m: HostMetrics | undefined, key: 'tcp_sockets' | 'udp_sockets' | 'processes') {
  const h = m?.host;
  return !h ||
    h.errors.includes(key === 'processes' ? 'processes_unavailable' : 'sockets_unavailable')
    ? '未知'
    : (h[key]?.toLocaleString('zh-CN') ?? '未知');
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
      label: '根文件系统',
      unit: '%',
      series: [series('disk', '使用率')],
      value: `${bytes(m?.disk?.used_bytes)} / ${bytes(m?.disk?.total_bytes)}`,
      detail: `可用 ${bytes(m?.disk?.available_bytes)}`,
    },
    {
      key: 'disk_io',
      label: '磁盘 IO',
      unit: 'B/s',
      series: [series('disk_read', '读取'), series('disk_write', '写入', '5 3')],
      value: `${byteRate(diskRate(m, 'read_bytes_per_second'))} / ${byteRate(diskRate(m, 'write_bytes_per_second'))}`,
      detail: '已上报设备吞吐量合计，分层设备可能重复计数',
    },
    {
      key: 'connections',
      label: '连接数',
      unit: '个',
      series: [series('tcp_sockets', 'TCP'), series('udp_sockets', 'UDP', '5 3')],
      value: `${hostCount(m, 'tcp_sockets')} / ${hostCount(m, 'udp_sockets')}`,
      detail: 'TCP / UDP socket 数，包含监听套接字',
    },
    {
      key: 'processes',
      label: '进程数',
      unit: '个',
      series: [series('processes', '进程数')],
      value: hostCount(m, 'processes'),
      detail: '进程上限未采集',
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

// Supply existing samples directly, without cadence checks or invented values.
// Select metrics available in the latest sample and omit incomplete samples so
// Arc cannot turn missing values into zero. All samples remain in the value list.
export function availableChartData(data: MetricHistory | undefined, series: ChartSeries[]) {
  const points = data?.points ?? [];
  const valid = (point: HistoryPoint, key: string) => {
    const stat = point.stats[key];
    return !!stat && stat.count > 0 && Number.isFinite(stat.sum / stat.count);
  };
  const last = [...points].reverse().find((point) => series.some((item) => valid(point, item.key)));
  const available = last ? series.filter((item) => valid(last, item.key)) : [];
  return {
    points: available.length
      ? points.filter((point) => available.every((item) => valid(point, item.key)))
      : [],
    series: available,
  };
}
