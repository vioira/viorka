import type { ServiceRef, SubscriptionService } from '@/api/subscriptions';
import type { BadgeTone } from '@/components/arc/badge/badge';

export const serviceRefKey = (item: ServiceRef) =>
  `${item.node_id}:${item.engine_id}:${item.service_id}`;

export const serviceDisplayLabel = (item: SubscriptionService) =>
  [
    item.node_name || item.node_id,
    item.service_name || item.service_id,
    ...(item.entry_type === 'relay' ? ['中转'] : []),
  ].join(' / ');

const unavailableReasons: Record<string, string> = {
  disabled: '中转线路已停用',
  awaiting_public: '等待中转公网检测',
  public_mapping_changed: '公网端点授权已变化',
  public_failed: '中转公网检测失败',
  probe_unavailable: '公网探测点不可用',
  awaiting_apply: '中转配置尚未确认',
  probe_unconfirmed: '入口 Agent 未能核对生效规则',
  runtime_unconfirmed: '中转实例运行状态待核对',
  landing_unavailable: '落地运行状态待核对',
  landing_changed: '落地连接参数已变化',
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
