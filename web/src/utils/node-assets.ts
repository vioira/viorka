import { billingPeriods, type NodeBilling } from '@/api/node-billing';
import type { NodeRecord } from '@/api/nodes';

export function nodeCost(billing?: NodeBilling) {
  if (!billing) return '尚未读取';
  if (!billing.period_months) return '免费';
  return `${billing.price} ${billing.currency} / ${billingPeriods[billing.period_months]}`;
}

export function nodeUptime(node: NodeRecord | null, now: number) {
  const { duration, sampleHint } = nodeUptimeParts(node, now);
  return sampleHint ? `${duration}（${sampleHint}）` : duration;
}

export function nodeUptimeParts(node: NodeRecord | null, now: number) {
  if (!node) return { duration: '尚未读取' };
  if (node.uptime_seconds === undefined || !node.uptime_sampled_at) return { duration: '暂无数据' };
  const seconds = Math.floor(node.uptime_seconds);
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
  if (node.state !== 'online' || now - Date.parse(node.uptime_sampled_at) >= 15 * 60000) {
    return { duration, sampleHint: `上次采样 ${localTime(node.uptime_sampled_at)}` };
  }
  return { duration };
}

const dateFields = { year: 'numeric', month: '2-digit', day: '2-digit' } as const;
const dateFormat = new Intl.DateTimeFormat('zh-CN', dateFields);
const minuteFormat = new Intl.DateTimeFormat('zh-CN', {
  ...dateFields,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
function localTime(utc: string, dateOnly = false) {
  return (dateOnly ? dateFormat : minuteFormat).format(new Date(utc));
}
export function nodeExpiry(billing: NodeBilling | undefined, now: number, dateOnly = false) {
  if (!billing) return '尚未读取';
  if (!billing.expires_at) return '永不过期';
  const time = localTime(billing.expires_at, dateOnly);
  return Date.parse(billing.expires_at) <= now ? `已到期 ${time}` : time;
}

const pad = (v: number) => String(v).padStart(2, '0');

export function localDate(date: Date) {
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
