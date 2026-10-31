import { ApiError, apiRequest } from './client';
import { isMonitoringSnapshot, type MonitoringSnapshot } from './monitoring';

export type NodeInventory = {
  sampled_at: string;
  os_id: string;
  os_name: string;
  os_version: string;
  public_ipv4: string;
  public_ipv6: string;
  errors: string[];
};

function isInventory(value: unknown): value is NodeInventory {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    ['sampled_at', 'os_id', 'os_name', 'os_version', 'public_ipv4', 'public_ipv6'].every(
      (key) => typeof v[key] === 'string',
    ) &&
    Number.isFinite(Date.parse(v.sampled_at as string)) &&
    Array.isArray(v.errors) &&
    v.errors.every((e) => typeof e === 'string')
  );
}

export type NodeRecord = {
  inventory?: NodeInventory;
  monitoring?: MonitoringSnapshot;
  id: string;
  name: string;
  kind: string;
  state: string;
  last_seen_at: string;
  os: string;
  arch: string;
  agent_version: string;
};

export const NODE_PAGE_SIZE = 50;
export async function listNodes(after = '', signal?: AbortSignal): Promise<NodeRecord[]> {
  const response = await apiRequest<{ items?: unknown } | null>('/nodes', {
    query: { limit: NODE_PAGE_SIZE, after },
    signal,
  });
  const fields = ['id', 'name', 'kind', 'state', 'last_seen_at', 'os', 'arch', 'agent_version'];
  if (
    !response ||
    !Array.isArray(response.items) ||
    response.items.some(
      (item) =>
        !item ||
        typeof item !== 'object' ||
        fields.some((key) => typeof item[key] !== 'string') ||
        !item.id ||
        (item.inventory !== undefined && !isInventory(item.inventory)) ||
        (item.monitoring !== undefined && !isMonitoringSnapshot(item.monitoring)) ||
        (item.last_seen_at && !Number.isFinite(Date.parse(item.last_seen_at))),
    )
  )
    throw new ApiError('节点数据格式无效，请刷新重试。', 'invalid-response');
  return response.items as NodeRecord[];
}

export const nodeKind = (kind: string) =>
  ({ vps: '公网 VPS', nat: 'NAT VPS', relay: '中转节点' })[kind] ?? kind;
export const nodeState = (state: string) =>
  ({ online: '在线', offline: '离线', disabled: '已禁用', pending: '待注册' })[state] ?? '未知';
export const nodeTime = (value: string) =>
  value ? new Date(value).toLocaleString('zh-CN') : '尚未上报';
