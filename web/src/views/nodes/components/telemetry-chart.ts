import type { LivePoint } from '@/api/realtime';
import {
  decimalBytes,
  filesystemUsagePercent,
  type TelemetryControl,
  type TelemetrySnapshot,
  telemetryStale,
} from '@/api/telemetry';
import { bitsPerSecond, type MetricChart, metricCharts } from './metric-chart';

const aliases: Record<string, string> = {
  cpu_percent: 'cpu',
  memory_percent: 'memory',
  swap_percent: 'swap',
  rx_bytes_per_second: 'rx',
  tx_bytes_per_second: 'tx',
  tcp_inuse: 'tcp_sockets',
  udp_inuse: 'udp_sockets',
};
export function telemetryChartPoints(s: TelemetrySnapshot): LivePoint[] {
  return s.points.map((p) => ({
    ...p,
    values: Object.fromEntries(
      Object.entries(p.values)
        .filter(([key]) => aliases[key])
        .map(([key, value]) => [aliases[key], value]),
    ),
  }));
}
export function telemetryCharts(
  s: TelemetrySnapshot,
  now: number,
  control?: TelemetryControl,
): MetricChart[] {
  const fast = telemetryStale(s, 'fast', now, control) ? undefined : s.fast;
  const full = telemetryStale(s, 'full', now, control) ? undefined : s.full;
  const cpu = fast?.errors.includes('cpu_unavailable') ? undefined : fast?.cpu_percent;
  const memory = fast?.errors.includes('memory_unavailable') ? undefined : fast;
  const network = (direction: 'rx' | 'tx') => {
    const key = direction === 'rx' ? 'rx_bytes_per_second' : 'tx_bytes_per_second';
    if (
      !fast ||
      fast.errors.includes('network_unavailable') ||
      fast.errors.includes('unsupported_platform') ||
      !fast.interfaces.length ||
      fast.interfaces.some(
        (i) =>
          i[key] === undefined || i.quality.includes('unknown') || i.quality.includes('partial'),
      )
    )
      return undefined;
    return fast.interfaces.reduce((sum, i) => sum + (i[key] ?? 0), 0);
  };
  const diskUsage = full?.errors.includes('disk_unavailable')
    ? null
    : filesystemUsagePercent(full?.disk_used, full?.disk_available);
  const known = (v?: number | string) => (v === undefined ? '未知' : String(v));
  return metricCharts()
    .filter((c) => c.key !== 'disk_io')
    .map((c) => {
      switch (c.key) {
        case 'cpu':
          return {
            ...c,
            value: cpu === undefined ? '未知' : `${cpu.toFixed(1)}%`,
            detail: 'CPU 采样使用率',
          };
        case 'memory':
          return {
            ...c,
            value: `${decimalBytes(memory?.ram_used)} / ${decimalBytes(memory?.ram_total)}`,
            detail: `Swap ${decimalBytes(memory?.swap_used)} / ${decimalBytes(memory?.swap_total)}`,
          };
        case 'network':
          return {
            ...c,
            value: `${bitsPerSecond(network('rx'))} / ${bitsPerSecond(network('tx'))}`,
            detail: '按已配置网卡过滤规则汇总',
          };
        case 'connections':
          return {
            ...c,
            value: fast?.errors.includes('sockets_unavailable')
              ? '未知'
              : `${known(fast?.tcp_inuse)} / ${known(fast?.udp_inuse)}`,
            detail: 'TCP / UDP in-use 数',
          };
        case 'load':
          return {
            ...c,
            value: full?.errors.includes('load_unavailable')
              ? '未知'
              : [full?.load_1, full?.load_5, full?.load_15].map(known).join(' / '),
            detail: '完整采集组最新值，实时曲线仅含快速组',
          };
        case 'disk':
          return {
            ...c,
            label: '文件系统容量',
            value: full?.errors.includes('disk_unavailable')
              ? '未知'
              : `${decimalBytes(full?.disk_used)} / ${decimalBytes(full?.disk_total)}`,
            detail: diskUsage === null ? '使用率未知' : `使用率 ${diskUsage}%（不含保留空间）`,
          };
        case 'processes':
          return {
            ...c,
            value: full?.errors.includes('processes_unavailable') ? '未知' : known(full?.processes),
            detail: '完整采集组最新值',
          };
        default:
          return c;
      }
    });
}
