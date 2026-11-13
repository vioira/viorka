import type { Session } from './auth';
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

export type NodeLocation = {
  country_code: string;
  subdivision: string;
  city: string;
};

function isLocation(value: unknown): value is NodeLocation {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.country_code === 'string' &&
    /^(?:[A-Z]{2})?$/.test(v.country_code) &&
    typeof v.subdivision === 'string' &&
    v.subdivision.length <= 256 &&
    typeof v.city === 'string' &&
    v.city.length <= 256
  );
}

const regionNames = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
export function nodeRegion(location?: NodeLocation): string {
  if (!location?.country_code) return '地区未知';
  const country = regionNames.of(location.country_code) ?? location.country_code;
  const flag = String.fromCodePoint(
    ...[...location.country_code].map((letter) => letter.charCodeAt(0) + 127397),
  );
  const region = location.city.trim() || location.subdivision.trim();
  return `${flag}${country}${region === country ? '' : region}`;
}

export type NodeRecord = {
  engines?: { name: string; version: string }[];
  location?: NodeLocation;
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
  if (!response || !Array.isArray(response.items))
    throw new ApiError('节点数据格式无效，请刷新重试。', 'invalid-response');
  return response.items.map(parseNode);
}

/** Read all cursor pages; reject a stalled cursor instead of looping indefinitely. */
export async function listAllNodes(signal?: AbortSignal): Promise<NodeRecord[]> {
  const items = new Map<string, NodeRecord>();
  const cursors = new Set<string>();
  let after = '';
  while (!signal?.aborted) {
    const page = await listNodes(after, signal);
    for (const node of page) items.set(node.id, node);
    if (page.length < NODE_PAGE_SIZE) return [...items.values()];
    const next = page.at(-1)?.id ?? '';
    if (!next || next === after || cursors.has(next))
      throw new ApiError('节点分页未前进，请刷新重试。', 'invalid-response');
    cursors.add(next);
    after = next;
  }
  throw new DOMException('请求已取消', 'AbortError');
}

export function parseNode(value: unknown): NodeRecord {
  if (!value || typeof value !== 'object')
    throw new ApiError('节点数据格式无效，请刷新重试。', 'invalid-response');
  const item = value as Record<string, unknown>;
  const fields = ['id', 'name', 'kind', 'state', 'last_seen_at', 'os', 'arch', 'agent_version'];
  if (
    fields.some((key) => typeof item[key] !== 'string') ||
    !item.id ||
    (item.engines !== undefined &&
      (!Array.isArray(item.engines) ||
        !item.engines.every(
          (e) => e && typeof e.name === 'string' && typeof e.version === 'string',
        ))) ||
    (item.inventory !== undefined && !isInventory(item.inventory)) ||
    (item.location !== undefined && !isLocation(item.location)) ||
    (item.monitoring !== undefined && !isMonitoringSnapshot(item.monitoring)) ||
    (item.last_seen_at && !Number.isFinite(Date.parse(item.last_seen_at as string)))
  )
    throw new ApiError('节点数据格式无效，请刷新重试。', 'invalid-response');
  return value as NodeRecord;
}

export const nodeKind = (kind: string) => ({ vps: '公网 VPS', nat: 'NAT VPS' })[kind] ?? kind;
export const nodeState = (state: string) =>
  ({ online: '在线', offline: '离线', disabled: '已禁用', pending: '待注册' })[state] ?? '未知';
export const nodeTime = (value: string) =>
  value ? new Date(value).toLocaleString('zh-CN') : '尚未上报';

export async function getNode(id: string, signal?: AbortSignal): Promise<NodeRecord> {
  const node = parseNode(await apiRequest<unknown>(`/nodes/${encodeURIComponent(id)}`, { signal }));
  if (node.id !== id) throw new ApiError('节点身份不匹配，请刷新重试。', 'invalid-response');
  return node;
}

export async function deleteNode(id: string, session: Session): Promise<void> {
  await apiRequest(`/nodes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    csrfToken: session.csrf_token,
    responseType: 'void',
  });
}
