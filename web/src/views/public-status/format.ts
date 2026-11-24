import type { StatusNode, StatusPage } from '@/api/public-status';
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
export const flag = (s: string) =>
  /^[A-Z]{2}$/.test(s)
    ? String.fromCodePoint(...Array.from(s, (ch) => ch.charCodeAt(0) + 127397))
    : '';
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
export function periodUsage(f: StatusNode['fast'], now: number) {
  if (!f?.billing_mode || !f.period_end || Date.parse(f.period_end) <= now) return null;
  const rx = f.billing_mode === 'outbound' ? '0' : f.period_rx,
    tx = f.billing_mode === 'inbound' ? '0' : f.period_tx;
  return rx === null || tx === null ? null : BigInt(rx) + BigInt(tx);
}
export const fixed = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(2));
export const cardClass = 'min-w-0 rounded-(--radius-panel) border border-border bg-surface p-5';
