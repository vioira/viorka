import { ApiError, apiRequest } from './client';
export type HostMetrics = {
  sampled_at: string;
  interval_seconds: number;
  errors: string[];
  cpu?: { logical_cpus: number; usage_percent?: number };
  memory?: {
    total_bytes: number;
    available_bytes: number;
    used_bytes: number;
    swap_total_bytes: number;
    swap_used_bytes: number;
  };
  load?: { one: number; five: number; fifteen: number };
  disk?: { total_bytes: number; used_bytes: number; available_bytes: number };
  uptime_seconds?: number;
  interfaces: {
    name: string;
    rx_bytes: number;
    tx_bytes: number;
    rx_bytes_per_second?: number;
    tx_bytes_per_second?: number;
  }[];
};
export type MetricPoint = { at: string; cpu?: number; memory?: number; rx?: number; tx?: number };
export type MonitoringSnapshot = {
  report_interval_seconds?: number;
  latest?: HostMetrics;
  received_at: string;
  stale: boolean;
  history: MetricPoint[];
};
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
export function isMonitoringSnapshot(v: unknown): v is MonitoringSnapshot {
  if (
    !record(v) ||
    typeof v.stale !== 'boolean' ||
    (v.report_interval_seconds !== undefined && !number(v.report_interval_seconds)) ||
    !date(v.received_at) ||
    !Array.isArray(v.history) ||
    v.history.length > 60
  )
    return false;
  if (
    !v.history.every(
      (p) =>
        record(p) &&
        date(p.at) &&
        ['cpu', 'memory', 'rx', 'tx'].every((k) => p[k] === undefined || number(p[k])),
    )
  )
    return false;
  if (v.latest === undefined) return true;
  const m = v.latest;
  if (
    !record(m) ||
    !date(m.sampled_at) ||
    !number(m.interval_seconds) ||
    !Array.isArray(m.errors) ||
    m.errors.length > 8 ||
    !m.errors.every((e) => typeof e === 'string') ||
    !Array.isArray(m.interfaces) ||
    m.interfaces.length > 64
  )
    return false;
  if (m.uptime_seconds !== undefined && !number(m.uptime_seconds)) return false;
  const groups = {
    cpu: ['logical_cpus'],
    memory: ['total_bytes', 'available_bytes', 'used_bytes', 'swap_total_bytes', 'swap_used_bytes'],
    load: ['one', 'five', 'fifteen'],
    disk: ['total_bytes', 'used_bytes', 'available_bytes'],
  };
  for (const [key, fields] of Object.entries(groups)) {
    const g = m[key];
    if (g !== undefined && (!record(g) || !fields.every((f) => number(g[f])))) return false;
  }
  if (
    record(m.cpu) &&
    m.cpu.usage_percent !== undefined &&
    (!number(m.cpu.usage_percent) || m.cpu.usage_percent > 100)
  )
    return false;
  return m.interfaces.every(
    (i) =>
      record(i) &&
      typeof i.name === 'string' &&
      number(i.rx_bytes) &&
      number(i.tx_bytes) &&
      ['rx_bytes_per_second', 'tx_bytes_per_second'].every(
        (k) => i[k] === undefined || number(i[k]),
      ),
  );
}
export async function getMonitoring(id: string, signal?: AbortSignal): Promise<MonitoringSnapshot> {
  const v = await apiRequest<unknown>(`/nodes/${encodeURIComponent(id)}/metrics`, { signal });
  if (!isMonitoringSnapshot(v))
    throw new ApiError('监控数据格式无效，请刷新重试。', 'invalid-response');
  return v;
}
export function isStale(s: MonitoringSnapshot | undefined, now: number) {
  return (
    !s?.latest ||
    s.stale ||
    now - Date.parse(s.received_at) >
      Math.max(90, s.latest.interval_seconds * 3, (s.report_interval_seconds ?? 0) * 3) * 1000
  );
}
export function bytes(v: number | undefined) {
  if (v === undefined || !Number.isFinite(v)) return '未知';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  const i = Math.min(units.length - 1, Math.max(0, Math.floor(Math.log2(Math.max(1, v)) / 10)));
  return `${(v / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
export const percent = (used?: number, total?: number) =>
  used !== undefined && total !== undefined && total > 0
    ? Math.round((used / total) * 1000) / 10
    : null;
// Official charts treat missing values as zero. Show only the latest continuous
// valid run so missing counters and offline gaps never become invented values.
export function recentSeries(
  points: MetricPoint[],
  key: 'cpu' | 'memory' | 'rx' | 'tx',
  maxGap = 90_000,
) {
  const out: MetricPoint[] = [];
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    if (p[key] === undefined || (out.length && Date.parse(out[0].at) - Date.parse(p.at) > maxGap))
      break;
    out.unshift(p);
  }
  return out;
}
