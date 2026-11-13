import type { MetricHistory } from '@/api/metric-history';
import { bytes } from '@/api/monitoring';

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
