import type { HistoryPoint, MetricHistory, Statistic } from './metric-history';
import { filesystemUsagePercent } from './telemetry';

type Mean = { sum: number | null; count: number };
type Peak = { max: number | null; count: number };
export type HistoryBucket = {
  bucket_start: number;
  last_sample_at: number;
  metric_semantics: string;
  quality_flags: number;
  cpu: Mean;
  ram_used: Mean;
  swap_used: Mean;
  net_in_speed: Peak;
  net_out_speed: Peak;
  tcp_count: Peak;
  udp_count: Peak;
  process_count: Peak;
  ram_total: string | null;
  swap_total: string | null;
  disk_total: string | null;
  disk_used: string | null;
  disk_available: string | null;
  net_in_total: string | null;
  net_out_total: string | null;
  net_month_in: string | null;
  net_month_out: string | null;
  load_1: number | null;
  load_5: number | null;
  load_15: number | null;
  disk_io: { sampled_at: number; quality_flags: number; [key: string]: unknown };
};
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const integer = (v: unknown): v is number => finite(v) && Number.isSafeInteger(v);
const timestamp = (v: unknown) => integer(v) && v <= 8640000000000000;
const decimal = (v: unknown) =>
  v === null ||
  (typeof v === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(v) && BigInt(v) <= 18446744073709551615n);
function aggregate(v: unknown, field: 'sum' | 'max') {
  return record(v) && integer(v.count) && (v.count === 0 ? v[field] === null : finite(v[field]));
}
const diskFields = [
  'read_speed',
  'write_speed',
  'read_iops',
  'write_iops',
  'read_await_ms',
  'write_await_ms',
  'await_ms',
  'util_percent',
];
function isBucket(v: unknown): v is HistoryBucket {
  return (
    record(v) &&
    integer(v.bucket_start) &&
    timestamp(v.bucket_start * 1000) &&
    timestamp(v.last_sample_at) &&
    typeof v.metric_semantics === 'string' &&
    integer(v.quality_flags) &&
    ['cpu', 'ram_used', 'swap_used'].every((k) => aggregate(v[k], 'sum')) &&
    ['net_in_speed', 'net_out_speed', 'tcp_count', 'udp_count', 'process_count'].every((k) =>
      aggregate(v[k], 'max'),
    ) &&
    [
      'ram_total',
      'swap_total',
      'disk_total',
      'disk_used',
      'disk_available',
      'net_in_total',
      'net_out_total',
      'net_month_in',
      'net_month_out',
    ].every((k) => decimal(v[k])) &&
    ['load_1', 'load_5', 'load_15'].every((k) => v[k] === null || finite(v[k])) &&
    record(v.disk_io) &&
    timestamp(v.disk_io.sampled_at) &&
    integer(v.disk_io.quality_flags) &&
    diskFields.every((k) => aggregate((v.disk_io as Record<string, unknown>)[k], 'max'))
  );
}
function chartPoint(b: HistoryBucket): HistoryPoint {
  const stats: Record<string, Statistic> = {};
  const put = (
    key: string,
    value: number | null,
    count: number,
    kind: 'mean' | 'peak' | 'latest',
  ) => {
    if (value !== null && count > 0 && Number.isFinite(value))
      stats[key] = { sum: value * count, max: value, count, kind };
  };
  const mean = (key: string, value: Mean, total?: string | null) => {
    if (value.sum === null || value.count === 0) return;
    const divisor = total === undefined ? 1 : total === null ? 0 : Number(total) / 100;
    if (divisor > 0) put(key, value.sum / value.count / divisor, value.count, 'mean');
  };
  mean('cpu', b.cpu);
  mean('memory', b.ram_used, b.ram_total);
  mean('swap', b.swap_used, b.swap_total);
  for (const [key, value] of Object.entries({
    rx: b.net_in_speed,
    tx: b.net_out_speed,
    tcp_sockets: b.tcp_count,
    udp_sockets: b.udp_count,
    processes: b.process_count,
  }))
    put(key, value.max, value.count, 'peak');
  for (const [key, value] of Object.entries({
    load_one: b.load_1,
    load_five: b.load_5,
    load_fifteen: b.load_15,
  }))
    put(key, value, 1, 'latest');
  if (b.metric_semantics === 'telemetry_v3')
    put('disk', filesystemUsagePercent(b.disk_used, b.disk_available), 1, 'latest');

  const diskKeys: Record<string, string> = { read_speed: 'disk_read', write_speed: 'disk_write' };
  for (const field of diskFields) {
    const value = b.disk_io[field] as Peak;
    put(diskKeys[field] ?? `disk_${field}`, value.max, value.count, 'peak');
  }
  return {
    at: new Date(b.bucket_start * 1000).toISOString(),
    last_sample_at: new Date(b.last_sample_at).toISOString(),
    stats,
    bucket: b,
  };
}
// Keep exact counters on bucket; Number conversion is only for chart coordinates.
// The compatibility chart projection is annotated so a peak is never labelled a mean.
export function parseHistoryResponse(v: unknown): MetricHistory | undefined {
  if (
    !record(v) ||
    ![30, 180, 720, 1440, 3600].includes(v.period_seconds as number) ||
    !Array.isArray(v.points) ||
    v.points.length > 169 ||
    !v.points.every(isBucket)
  )
    return undefined;
  const points = v.points as HistoryBucket[];
  if (
    points.some(
      (p, i) =>
        p.bucket_start % (v.period_seconds as number) !== 0 ||
        (i > 0 && p.bucket_start <= points[i - 1].bucket_start),
    )
  )
    return undefined;
  return {
    period_seconds: v.period_seconds as number,
    points: points.map(chartPoint),
    typed: true,
  };
}
