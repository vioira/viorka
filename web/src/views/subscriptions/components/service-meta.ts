import type { ServiceRef, SubscriptionService } from '@/api/subscriptions';
import type { BadgeTone } from '@/components/arc/badge/badge';

export const serviceRefKey = (item: ServiceRef) =>
  `${item.node_id}:${item.engine_id}:${item.service_id}`;

export const serviceDisplayLabel = (item: SubscriptionService) =>
  [item.node_name || item.node_id, item.service_name || item.service_id].join(' / ');

const unavailableReasons: Record<string, string> = {
  service_removed: '服务已删除，请移除或重新选择',
  permission_lost: '节点导出权限已失效',
  restore_verification_required: '等待恢复核对',
  restore_endpoint_confirmation_required: '等待确认公网入口',
  service_unavailable: '服务停用或公网入口不可用',
};

export const unavailableReasonLabel = (reason: string) =>
  unavailableReasons[reason] ?? '服务不可用';

export const accessResultTone = (code: string): BadgeTone => {
  if (code === 'ok') return 'success';
  if (code === 'unrecognized') return 'warning';
  if (code === 'no_services' || code === 'forbidden' || code === 'unavailable') return 'danger';
  return 'neutral';
};
