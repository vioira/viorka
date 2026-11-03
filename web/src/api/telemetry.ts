import type { LivePoint } from './realtime';
import { isTrafficSettings, type TrafficSettings } from './traffic';

export type TelemetrySettings = {
  traffic?: TrafficSettings;
  log_level?: 'debug' | 'info' | 'warn' | 'error';
  revision: number;
  collection_seconds: number;
  http_report_seconds: number;
  wss_report_seconds: number;
  connection_mode: 'auto_http_wss';
};
type Observation = { sequence: string; sampled_at: string; errors: string[] };
export type TelemetryInterface = {
  name: string;
  ifindex: string;
  rx_bytes: string;
  tx_bytes: string;
  rx_bytes_per_second?: number;
  tx_bytes_per_second?: number;
  quality: string[];
};
export type TelemetryFast = Observation & {
  elapsed_seconds: number;
  cpu_percent?: number;
  ram_total?: string;
  ram_used?: string;
  swap_total?: string;
  swap_used?: string;
  uptime_seconds?: number;
  tcp_inuse?: string;
  udp_inuse?: string;
  interfaces: TelemetryInterface[];
  filter_revision: string;
  traffic?: {
    month_start: string;
    period_end?: string;
    rx_bytes?: string;
    tx_bytes?: string;
    filter_revision: string;
    quality: string[];
  };
};
export type TelemetryDisk = {
  quality: string[];
  read_bytes_per_second?: number;
  write_bytes_per_second?: number;
  read_iops?: number;
  write_iops?: number;
  read_await_ms?: number;
  write_await_ms?: number;
  await_ms?: number;
  util_percent?: number;
};
export type TelemetryFull = Observation & {
  elapsed_seconds: number;
  load_1?: number;
  load_5?: number;
  load_15?: number;
  processes?: string;
  disk_total?: string;
  disk_used?: string;
  disk_available?: string;
  disk_io?: TelemetryDisk;
  os_id?: string;
  os_name?: string;
  os_version?: string;
};
export type TelemetryIP = Observation & { ipv4?: string; ipv6?: string };
export type TelemetryPoint = LivePoint & { sample_sequence: string };
export type TelemetrySnapshot = {
  settings?: TelemetrySettings;
  run_id: string;
  metrics_received_at: string;
  fast?: TelemetryFast;
  full?: TelemetryFull;
  public_ip?: TelemetryIP;
  fast_received_at: string;
  full_received_at: string;
  public_ip_received_at: string;
  fast_stale: boolean;
  full_stale: boolean;
  public_ip_stale: boolean;
  sequence: number;
  reset: boolean;
  points: TelemetryPoint[];
};
export type TelemetryControl = {
  mode: 'http' | 'pending' | 'realtime' | 'degraded';
  references: number;
  lease_remaining_seconds: number;
};
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const integer = (v: unknown): v is number => finite(v) && Number.isSafeInteger(v);
const text = (v: unknown, max = 256): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max;
const date = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v));
export const decimalCounter = (v: unknown): v is string =>
  typeof v === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(v) && BigInt(v) <= 9223372036854775807n;
const strings = (v: unknown, max: number) =>
  Array.isArray(v) &&
  v.length <= max &&
  v.every((s) => text(s, 64)) &&
  new Set(v).size === v.length;
const optional = (v: Record<string, unknown>, keys: string[], check: (v: unknown) => boolean) =>
  keys.every((k) => v[k] === undefined || check(v[k]));
const array = (v: unknown, max: number, check: (v: unknown) => boolean) =>
  Array.isArray(v) && v.length <= max && v.every(check);
const observation = (v: unknown): v is Record<string, unknown> =>
  record(v) &&
  decimalCounter(v.sequence) &&
  v.sequence !== '0' &&
  date(v.sampled_at) &&
  strings(v.errors, 7);
const revision = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const bounded = (v: unknown, min: number, max: number) => integer(v) && v >= min && v <= max;
export function isTelemetrySettings(v: unknown): v is TelemetrySettings {
  return (
    record(v) &&
    (v.traffic === undefined || isTrafficSettings(v.traffic)) &&
    bounded(v.revision, 1, Number.MAX_SAFE_INTEGER) &&
    bounded(v.collection_seconds, 1, 60) &&
    bounded(v.http_report_seconds, 30, 180) &&
    bounded(v.wss_report_seconds, 1, 5) &&
    (v.log_level === undefined ||
      ['debug', 'info', 'warn', 'error'].includes(String(v.log_level))) &&
    v.connection_mode === 'auto_http_wss'
  );
}
function nic(v: unknown) {
  return (
    record(v) &&
    text(v.name, 64) &&
    decimalCounter(v.ifindex) &&
    BigInt(v.ifindex) > 0n &&
    BigInt(v.ifindex) <= 4294967295n &&
    decimalCounter(v.rx_bytes) &&
    decimalCounter(v.tx_bytes) &&
    strings(v.quality, 9) &&
    optional(v, ['rx_bytes_per_second', 'tx_bytes_per_second'], finite)
  );
}
function fast(v: unknown) {
  if (
    !observation(v) ||
    !finite(v.elapsed_seconds) ||
    v.elapsed_seconds > 600 ||
    !revision(v.filter_revision) ||
    !array(v.interfaces, 64, nic) ||
    !optional(
      v,
      ['ram_total', 'ram_used', 'swap_total', 'swap_used', 'tcp_inuse', 'udp_inuse'],
      decimalCounter,
    ) ||
    !optional(v, ['cpu_percent', 'uptime_seconds'], finite) ||
    (finite(v.cpu_percent) && v.cpu_percent > 100)
  )
    return false;
  if (v.traffic !== undefined) {
    const t = v.traffic;
    if (
      !record(t) ||
      !date(t.month_start) ||
      !revision(t.filter_revision) ||
      !strings(t.quality, 9) ||
      !optional(t, ['rx_bytes', 'tx_bytes'], decimalCounter)
    )
      return false;
  }
  return true;
}
function disk(v: unknown) {
  return (
    record(v) &&
    strings(v.quality, 9) &&
    optional(
      v,
      [
        'read_bytes_per_second',
        'write_bytes_per_second',
        'read_iops',
        'write_iops',
        'read_await_ms',
        'write_await_ms',
        'await_ms',
        'util_percent',
      ],
      finite,
    ) &&
    (!finite(v.util_percent) || v.util_percent <= 100)
  );
}
function full(v: unknown) {
  return (
    observation(v) &&
    finite(v.elapsed_seconds) &&
    v.elapsed_seconds <= 600 &&
    optional(v, ['load_1', 'load_5', 'load_15'], finite) &&
    optional(v, ['processes', 'disk_total', 'disk_used', 'disk_available'], decimalCounter) &&
    optional(v, ['os_id', 'os_name', 'os_version'], text) &&
    optional(v, ['disk_io'], disk)
  );
}
function ip(v: unknown) {
  return observation(v) && optional(v, ['ipv4', 'ipv6'], (v) => text(v, 45));
}
export function isTelemetrySnapshot(v: unknown): v is TelemetrySnapshot {
  if (
    !record(v) ||
    typeof v.run_id !== 'string' ||
    (v.run_id !== '' &&
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v.run_id)) ||
    !['metrics_received_at', 'fast_received_at', 'full_received_at', 'public_ip_received_at'].every(
      (k) => date(v[k]),
    ) ||
    !['fast_stale', 'full_stale', 'public_ip_stale', 'reset'].every(
      (k) => typeof v[k] === 'boolean',
    ) ||
    !integer(v.sequence) ||
    !Array.isArray(v.points) ||
    v.points.length > 600 ||
    (v.settings !== undefined && !isTelemetrySettings(v.settings)) ||
    (v.fast !== undefined && !fast(v.fast)) ||
    (v.full !== undefined && !full(v.full)) ||
    (v.public_ip !== undefined && !ip(v.public_ip))
  )
    return false;
  let previous = 0;
  for (const p of v.points) {
    if (
      !record(p) ||
      (p.group !== undefined && p.group !== 'fast' && p.group !== 'full') ||
      !integer(p.sequence) ||
      p.sequence <= previous ||
      p.sequence > v.sequence ||
      !decimalCounter(p.sample_sequence) ||
      p.sample_sequence === '0' ||
      !date(p.at) ||
      !date(p.received_at) ||
      !record(p.values) ||
      Object.keys(p.values).length > 32 ||
      !Object.values(p.values).every(finite)
    )
      return false;
    previous = p.sequence;
  }
  return true;
}
export function isTelemetryControl(v: unknown): v is TelemetryControl {
  return (
    record(v) &&
    ['http', 'pending', 'realtime', 'degraded'].includes(String(v.mode)) &&
    bounded(v.references, 0, 128) &&
    bounded(v.lease_remaining_seconds, 0, 90)
  );
}
export function telemetryStale(
  s: TelemetrySnapshot,
  group: 'fast' | 'full' | 'public_ip',
  now: number,
  control?: TelemetryControl,
) {
  const settings = s.settings;
  const report = settings?.http_report_seconds ?? 60;
  const realtime = control?.mode === 'realtime';
  const fastTTL = realtime
    ? Math.max(90, 3 * (settings?.wss_report_seconds ?? 2))
    : Math.max(90, 3 * (settings?.collection_seconds ?? 30), 3 * report);
  const ttl =
    (group === 'public_ip' ? 1800 : group === 'full' ? Math.max(90, 3 * report) : fastTTL) * 1000;
  const sample = s[group];
  return (
    !sample ||
    s[`${group}_stale`] ||
    now - Date.parse(sample.sampled_at) >= ttl ||
    now - Date.parse(s[`${group}_received_at`]) >= ttl
  );
}
// Exact integer arithmetic for displayed capacities, without rounding through Number.
export function decimalBytes(value?: string) {
  if (value === undefined || !decimalCounter(value)) return '未知';
  const n = BigInt(value);
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB'];
  let index = 0;
  let divisor = 1n;
  while (index < units.length - 1 && n >= divisor * 1024n) {
    index++;
    divisor *= 1024n;
  }
  const tenths = (n * 10n + divisor / 2n) / divisor;
  return index === 0 ? `${n} B` : `${tenths / 10n}.${tenths % 10n} ${units[index]}`;
}
export function decimalPercent(used?: string, total?: string) {
  if (
    used === undefined ||
    total === undefined ||
    !decimalCounter(used) ||
    !decimalCounter(total) ||
    BigInt(total) === 0n
  )
    return null;
  return Number((BigInt(used) * 1000n + BigInt(total) / 2n) / BigInt(total)) / 10;
}

// df-style usage excludes reserved blocks and rounds upward using exact counters.
export function filesystemUsagePercent(used?: string | null, available?: string | null) {
  if (!decimalCounter(used) || !decimalCounter(available)) return null;
  const numerator = BigInt(used) * 100n;
  const denominator = BigInt(used) + BigInt(available);
  if (denominator === 0n) return null;
  return Number((numerator + denominator - 1n) / denominator);
}
