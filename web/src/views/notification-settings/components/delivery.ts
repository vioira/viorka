import type { AlertSettings } from '@/api/alerts';

const states: Record<string, string> = {
  accepted: '渠道已接受',
  queued: '等待投递',
  retry: '等待重试',
  failed: '投递失败',
};
export const deliveryLabel = (state: string) => states[state] ?? '未知状态';

export function channelSummary(data: AlertSettings) {
  const channels = data.config.channels;
  if (!channels.length) return '未配置';
  const records = channels.map((c) => data.delivery[c.id]).filter(Boolean);
  if (records.some((d) => d.state === 'failed')) return '投递失败';
  if (channels.some((c) => !data.credentials[c.id])) return '待配凭证';
  if (records.some((d) => d.state === 'retry')) return '等待重试';
  if (records.some((d) => d.state === 'queued')) return '等待投递';
  if (records.length === channels.length && records.every((d) => d.state === 'accepted'))
    return '投递正常';
  return '待验证';
}
