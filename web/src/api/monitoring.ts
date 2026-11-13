import { ApiError, apiRequest } from './client';
import { isMetricTrends, type MetricTrends } from './metric-trends';
import {
  isTelemetryControl,
  isTelemetrySnapshot,
  type TelemetryControl,
  type TelemetrySnapshot,
  telemetryStale,
} from './telemetry';
export type MetricPoint = { at: string; cpu?: number; memory?: number; rx?: number; tx?: number };
export type MonitoringSnapshot = {
  metric_trends?: MetricTrends;
  management_online?: boolean;
  telemetry?: TelemetrySnapshot;
  telemetry_control?: TelemetryControl;
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
    (v.management_online !== undefined && typeof v.management_online !== 'boolean') ||
    (v.telemetry !== undefined && !isTelemetrySnapshot(v.telemetry)) ||
    (v.metric_trends !== undefined && !isMetricTrends(v.metric_trends)) ||
    (v.telemetry_control !== undefined && !isTelemetryControl(v.telemetry_control)) ||
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

  return v.latest === undefined;
}
export async function getMonitoring(id: string, signal?: AbortSignal): Promise<MonitoringSnapshot> {
  const v = await apiRequest<unknown>(`/nodes/${encodeURIComponent(id)}/metrics`, { signal });
  if (!isMonitoringSnapshot(v))
    throw new ApiError('监控数据格式无效，请刷新重试。', 'invalid-response');
  return v;
}
export function isStale(s: MonitoringSnapshot | undefined, now: number) {
  if (s?.telemetry) return telemetryStale(s.telemetry, 'fast', now, s.telemetry_control);

  return true;
}
export function bytes(v: number | undefined) {
  if (v === undefined || !Number.isFinite(v)) return '未知';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(units.length - 1, Math.max(0, Math.floor(Math.log10(Math.max(1, v)) / 3)));
  return `${(v / 1000 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
// Explicit REST refreshes must be able to supersede a disconnected SSE cache.
export function newerMonitoring(stream?: MonitoringSnapshot, rest?: MonitoringSnapshot) {
  if (!stream) return rest;
  if (!rest) return stream;
  return Date.parse(rest.received_at) > Date.parse(stream.received_at) ? rest : stream;
}
