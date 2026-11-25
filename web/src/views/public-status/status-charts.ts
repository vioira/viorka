import type { ProbeLine, ProbePoint, StatusNode } from '@/api/public-status';
import { decimalBytes, filesystemUsagePercent } from '@/api/telemetry';
import {
  bitsPerSecond,
  byteRate,
  type MetricChart,
  metricCharts,
} from '@/views/nodes/components/metric-chart';
import { statusFastFresh, statusFullFresh } from './format';

const knownNumber = (v?: number | null) => (v == null ? '未知' : String(Number(v.toFixed(2))));

export function statusMetricCharts(node: StatusNode, now: number): MetricChart[] {
  const fast = statusFastFresh(node, now) ? node.fast : null;
  const full = statusFullFresh(node, now) ? node.full : null;
  const diskUsage = full ? filesystemUsagePercent(full.disk_used, full.disk_available) : null;
  const cpuSpec = [node.cpu_cores ? `${node.cpu_cores} 核` : '', node.arch ?? '']
    .filter(Boolean)
    .join(' / ');

  return metricCharts().map((chart) => {
    switch (chart.key) {
      case 'cpu':
        return {
          ...chart,
          value: fast?.cpu == null ? '未知' : `${fast.cpu.toFixed(1)}%`,
          detail: cpuSpec || 'CPU 采样使用率',
        };
      case 'memory':
        return {
          ...chart,
          value:
            fast?.ram_used != null && fast?.ram_total != null
              ? `${decimalBytes(fast.ram_used)} / ${decimalBytes(fast.ram_total)}`
              : '未知',
          detail:
            fast?.swap_used != null && fast?.swap_total != null
              ? `Swap ${decimalBytes(fast.swap_used)} / ${decimalBytes(fast.swap_total)}`
              : 'Swap 未知',
        };
      case 'network':
        return {
          ...chart,
          value: `${bitsPerSecond(fast?.rx ?? undefined)} / ${bitsPerSecond(fast?.tx ?? undefined)}`,
          detail: '实时下行 / 上行汇总',
        };
      case 'connections':
        return {
          ...chart,
          value:
            fast?.tcp_inuse != null && fast?.udp_inuse != null
              ? `${fast.tcp_inuse} / ${fast.udp_inuse}`
              : '未知',
          detail: 'TCP / UDP in-use 数',
        };
      case 'load':
        return {
          ...chart,
          value:
            full && (full.load1 != null || full.load5 != null || full.load15 != null)
              ? [full.load1, full.load5, full.load15].map(knownNumber).join(' / ')
              : '未知',
          detail: '1 / 5 / 15 分钟平均负载',
        };
      case 'disk':
        return {
          ...chart,
          label: '文件系统容量',
          value:
            full?.disk_used != null && full?.disk_total != null
              ? `${decimalBytes(full.disk_used)} / ${decimalBytes(full.disk_total)}`
              : '未知',
          detail: diskUsage == null ? '使用率未知' : `使用率 ${diskUsage}%`,
        };
      case 'disk_io': {
        const io = full?.disk_io;
        return {
          ...chart,
          value: io
            ? `${byteRate(io.read_bytes_per_second)} / ${byteRate(io.write_bytes_per_second)}`
            : '未知',
          detail: !io
            ? '等待有效磁盘采样'
            : io.quality.length
              ? '部分数据或尚未建立有效采样'
              : '读取 / 写入速率',
        };
      }
      case 'processes':
        return {
          ...chart,
          value: full?.processes != null ? full.processes : '未知',
          detail: '完整采集组最新值',
        };
      default:
        return chart;
    }
  });
}

function summarizePoints(points: ProbePoint[]): { ping: number; loss: number } | undefined {
  if (!points.length) return undefined;
  const pings = points
    .map((p) => p.ping)
    .filter((p) => p >= 0)
    .sort((a, b) => a - b);
  const mid = Math.floor(pings.length / 2);
  const ping = !pings.length
    ? -1
    : pings.length % 2
      ? pings[mid]
      : (pings[mid - 1] + pings[mid]) / 2;
  const loss = points.reduce((sum, p) => sum + p.loss, 0) / points.length;
  return { ping, loss };
}

export function statusProbeHistorySlots(
  line: ProbeLine,
  startIso: string,
  endIso: string,
  periodSeconds: number,
) {
  const periodMs = periodSeconds * 1000;
  const end = Math.floor(Date.parse(endIso) / periodMs) * periodSeconds;
  const start = Math.floor(Date.parse(startIso) / periodMs) * periodSeconds;
  const latestBySlot = new Map<number, ProbePoint>();
  for (const point of line.history) {
    const at = Date.parse(point.at);
    const bucket = Math.floor(at / periodMs) * periodSeconds;
    const previous = latestBySlot.get(bucket);
    if (!previous || at > Date.parse(previous.at)) latestBySlot.set(bucket, point);
  }
  const slots: { start: number; point?: ProbePoint }[] = [];
  for (let at = start; at <= end; at += periodSeconds) {
    slots.push({ start: at, point: latestBySlot.get(at) });
  }
  return slots;
}

export function statusProbeHistoryBlocks(
  line: ProbeLine,
  startIso: string,
  endIso: string,
  periodSeconds: number,
) {
  const startSec = Date.parse(startIso) / 1000;
  const endSec = Date.parse(endIso) / 1000;
  const span = Math.max(periodSeconds, endSec - startSec);
  const width = Math.max(periodSeconds, Math.ceil(span / periodSeconds / 20) * periodSeconds);
  const alignedStart = Math.floor(startSec / width) * width;
  const blocks: { start: number; end: number; point?: { ping: number; loss: number } }[] = [];
  for (let at = alignedStart; at < endSec; at += width) {
    const start = Math.max(startSec, at);
    const end = Math.min(endSec, at + width);
    const points = line.history.filter((p) => {
      const sec = Date.parse(p.at) / 1000;
      return sec >= start && sec < end;
    });
    blocks.push({ start, end, point: summarizePoints(points) });
  }
  return {
    width,
    blocks,
    summary: summarizePoints(line.history) ?? line.latest ?? undefined,
  };
}
