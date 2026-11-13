import {
  decimalBytes,
  filesystemUsagePercent,
  type TelemetryControl,
  type TelemetrySnapshot,
  telemetryStale,
} from '@/api/telemetry';
import { bitsPerSecond, byteRate, type MetricChart, metricCharts } from './metric-chart';

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
  const known = (v?: number | string) =>
    v === undefined ? '未知' : typeof v === 'number' ? String(Number(v.toFixed(2))) : v;
  return metricCharts().map((c) => {
    if (c.key.startsWith('disk_io')) {
      const d = full?.errors.includes('disk_io_unavailable') ? undefined : full?.disk_io;
      const value =
        c.key === 'disk_io'
          ? `${byteRate(d?.read_bytes_per_second)} / ${byteRate(d?.write_bytes_per_second)}`
          : c.key === 'disk_io_iops'
            ? `${known(d?.read_iops)} / ${known(d?.write_iops)}`
            : c.key === 'disk_io_await'
              ? known(d?.await_ms)
              : known(d?.util_percent);
      return {
        ...c,
        value,
        detail: !d
          ? '等待有效磁盘采样'
          : d.quality.length
            ? '部分数据或尚未建立有效采样'
            : '有效磁盘汇总，等待时间按 IO 加权',
      };
    }
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
          detail: '完整采集组原始采样',
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
