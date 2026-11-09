import type { Session } from './auth';
import { apiRequest } from './client';
import type { TaskRecord } from './tasks';

export type TrafficSettings = {
  interfaces: string;
  reset_day: number;
  reset_hour: number;
  reset_minute: number;
  timezone: string;
  billing_mode: 'both' | 'outbound' | 'inbound';
  quota_bytes: string;
};
export const defaultTrafficSettings: TrafficSettings = {
  interfaces: '',
  reset_day: 1,
  reset_hour: 0,
  reset_minute: 0,
  timezone: 'UTC',
  billing_mode: 'both',
  quota_bytes: '0',
};
export function isTrafficSettings(v: unknown): v is TrafficSettings {
  if (!v || typeof v !== 'object') return false;
  const s = v as TrafficSettings;
  if (
    typeof s.interfaces !== 'string' ||
    s.interfaces.length > 4159 ||
    !Number.isInteger(s.reset_day) ||
    s.reset_day < 1 ||
    s.reset_day > 31 ||
    !Number.isInteger(s.reset_hour) ||
    s.reset_hour < 0 ||
    s.reset_hour > 23 ||
    !Number.isInteger(s.reset_minute) ||
    s.reset_minute < 0 ||
    s.reset_minute > 59 ||
    !['both', 'outbound', 'inbound'].includes(s.billing_mode) ||
    typeof s.quota_bytes !== 'string' ||
    !/^(0|[1-9][0-9]{0,18})$/.test(s.quota_bytes) ||
    BigInt(s.quota_bytes) > 9223372036854775807n ||
    typeof s.timezone !== 'string' ||
    !s.timezone ||
    s.timezone === 'Local'
  )
    return false;
  const names = s.interfaces ? s.interfaces.split(',') : [];
  if (
    names.length > 64 ||
    new Set(names).size !== names.length ||
    names.some((n) => !/^[A-Za-z0-9_.:-]{1,64}$/.test(n))
  )
    return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: s.timezone });
    return true;
  } catch {
    return false;
  }
}
export function gbToBytes(value: string): string {
  if (!/^\d+(\.\d{1,6})?$/.test(value))
    throw new Error('流量请输入非负数，最多六位小数，单位 GB。');
  const [whole, part = ''] = value.split('.');
  const bytes = ((BigInt(whole) * 1000000n + BigInt(part.padEnd(6, '0'))) * 1000000000n) / 1000000n;
  if (bytes > 9223372036854775807n) throw new Error('流量值超出支持范围。');
  return bytes.toString();
}
export function billableTraffic(
  rx: string | undefined,
  tx: string | undefined,
  mode: TrafficSettings['billing_mode'],
): bigint | undefined {
  if (mode === 'inbound') return rx === undefined ? undefined : BigInt(rx);
  if (mode === 'outbound') return tx === undefined ? undefined : BigInt(tx);
  return rx === undefined || tx === undefined ? undefined : BigInt(rx) + BigInt(tx);
}
export function calibrateTraffic(
  session: Session,
  id: string,
  key: string,
  period: string,
  rx: string,
  tx: string,
) {
  return apiRequest<TaskRecord>(`/nodes/${encodeURIComponent(id)}/traffic-calibrations`, {
    method: 'POST',
    csrfToken: session.csrf_token,
    json: {
      idempotency_key: key,
      calibration: { period_start: period, rx_bytes: rx, tx_bytes: tx },
    },
  });
}
