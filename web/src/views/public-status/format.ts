import type { StatusNode, StatusPage } from '@/api/public-status';
import { formatIPRegion } from '@/utils/ip-region';

export function bytes(n: number | string | bigint | null | undefined) {
  if (n == null) return '—';
  let v = Number(n);
  let i = 0;
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} ${units[i]}`;
}
export function speed(n: number | null | undefined) {
  return n == null ? '—' : `${bytes(n)}/s`;
}
export const stamp = (date: string) => new Date(date).toLocaleString('zh-CN', { hour12: false });
export const percent = (n: number | null | undefined) => (n == null ? '—' : `${n.toFixed(1)}%`);
export function renew(expires: string | null, now: number) {
  if (!expires) return '未登记';
  const days = Math.ceil((Date.parse(expires) - now) / 86400000);
  return Date.parse(expires) <= now ? '已到期' : `剩余 ${days} 天`;
}
// Shift calendar months with end-of-month clamping. A leap year or a short month
// must not silently move the paid interval into the following month.
function previousPeriod(end: number, months: number) {
  const d = new Date(end),
    day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.getTime();
}
export function rentalValue(n: StatusNode, rates: StatusPage['rates'], now: number): number | null {
  if ((n.price !== null && Number(n.price) === 0) || (n.expires && Date.parse(n.expires) <= now))
    return 0;
  if (n.price === null || !n.months || !n.expires) return null;
  const end = Date.parse(n.expires),
    start = previousPeriod(end, n.months);
  let rate = 1;
  if (n.currency !== 'CNY') {
    const cny = rates.quotes?.CNY?.rate,
      source = n.currency === 'USD' ? 1 : rates.quotes?.[n.currency]?.rate;
    if (!cny || !source) return null;
    rate = cny / source;
  }
  return (Number(n.price) * rate * (end - now)) / (end - start);
}
export function monthlyCNY(n: StatusNode, rates: StatusPage['rates']): number | null {
  if (n.price === null || Number(n.price) === 0 || !n.months) return null;
  let rate = 1;
  if (n.currency !== 'CNY') {
    const cny = rates.quotes?.CNY?.rate,
      source = n.currency === 'USD' ? 1 : rates.quotes?.[n.currency]?.rate;
    if (!cny || !source) return null;
    rate = cny / source;
  }
  return (Number(n.price) * rate) / n.months;
}
export function periodUsage(f: StatusNode['fast'], now: number) {
  if (!f?.billing_mode || !f.period_end || Date.parse(f.period_end) <= now) return null;
  const rx = f.billing_mode === 'outbound' ? '0' : f.period_rx,
    tx = f.billing_mode === 'inbound' ? '0' : f.period_tx;
  return rx === null || tx === null ? null : BigInt(rx) + BigInt(tx);
}
export const fixed = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(2));
export const cardClass = 'min-w-0 rounded-(--radius-panel) border border-border bg-surface p-5';

export function statusNodeKind(kind?: string) {
  if (!kind) return '未知';
  return ({ vps: '公网 VPS', nat: 'NAT VPS' } as Record<string, string>)[kind] ?? kind;
}

export function statusRegion(node: Pick<StatusNode, 'country' | 'subdivision' | 'city'>) {
  return formatIPRegion(node.country, node.city?.trim() || node.subdivision?.trim());
}

export function statusFastFresh(node: StatusNode, now: number) {
  return Boolean(node.fast && Date.parse(node.fast.expires_at) > now);
}

export function statusFullFresh(node: StatusNode, now: number) {
  return Boolean(node.full && !node.full.stale && Date.parse(node.full.expires_at) > now);
}

export function statusUptime(node: StatusNode, now: number) {
  if (node.uptime == null || !node.uptime_at) return '暂无数据';
  const seconds = Math.floor(node.uptime);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds / 3600) % 24;
  const minutes = Math.floor(seconds / 60) % 60;
  const duration = days
    ? `${days} 天 ${hours} 小时`
    : hours
      ? `${hours} 小时 ${minutes} 分钟`
      : minutes
        ? `${minutes} 分钟`
        : `${seconds} 秒`;
  if (!node.online || now - Date.parse(node.uptime_at) >= 15 * 60000) {
    return `${duration}（上次采样 ${stamp(node.uptime_at)}）`;
  }
  return duration;
}

export function exactBytes(n: number | string | bigint | null | undefined) {
  if (n == null || n === '') return '未知';
  try {
    const value = typeof n === 'number' ? Math.round(n) : n;
    return `${BigInt(value).toLocaleString('zh-CN')} B`;
  } catch {
    return '未知';
  }
}

export function rentalPeriodProgress(expires: string | null, months: number | null, now: number) {
  if (!expires || !months) return null;
  const end = Date.parse(expires);
  if (!Number.isFinite(end)) return null;
  const start = previousPeriod(end, months);
  if (end <= start) return null;
  const elapsed = Math.min(end - start, Math.max(0, now - start));
  return {
    start,
    end,
    percent: (elapsed / (end - start)) * 100,
  };
}

export function statusRelativeTime(date: string | null | undefined, now: number) {
  if (!date) return '未记录';
  const diffSec = Math.max(0, Math.floor((now - Date.parse(date)) / 1000));
  if (diffSec < 60) return `${diffSec} 秒前`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  return `${Math.floor(diffHour / 24)} 天前`;
}

export const statusRangeLabels = {
  '1h': '1 小时',
  '6h': '6 小时',
  '24h': '24 小时',
  '2d': '2 天',
  '7d': '7 天',
} as const;
