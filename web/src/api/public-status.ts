import { ApiError, apiRequest } from './client';
import { isMetricTrends, type MetricTrends, mergeMetricTrends } from './metric-trends';

export type Category = { id: string; kind: 'group' | 'tag'; name: string; shared: boolean };
export type Catalog = { revision: number; items: Category[] };
export type PublishedNode = { id: string; alias: string };
export type Publication = { revision: number; enabled: boolean; nodes: PublishedNode[] };
export type ProbePoint = { at: string; ping: number; loss: number };
export type ProbeLine = {
  slot: number;
  name: string;
  latest: ProbePoint | null;
  history: ProbePoint[];
};
export type Speed = { at: string; rx: number | null; tx: number | null };
export type StatusDiskIO = {
  read_bytes_per_second?: number;
  write_bytes_per_second?: number;
  read_iops?: number;
  write_iops?: number;
  await_ms?: number;
  util_percent?: number;
  quality: string[];
};
export type StatusDailyTraffic = {
  day_start: string;
  day_end: string;
  rx_bytes: string;
  tx_bytes: string;
  sampled_at: string;
  quality: number;
};
export type StatusNode = PublishedNode & {
  cpu_cores?: number;
  online: boolean;
  kind?: string;
  country: string;
  subdivision?: string;
  city?: string;
  os: string;
  arch?: string;
  group: string;
  tags: string[];
  ipv4: boolean;
  ipv6: boolean;
  ip_at: string | null;
  last_seen_at?: string;
  uptime: number | null;
  uptime_at: string | null;
  price: string | null;
  currency: string;
  months: number | null;
  expires: string | null;
  lifetime: { start: string; rx: string; tx: string; partial: boolean } | null;
  daily?: StatusDailyTraffic | null;
  fast: {
    sampled_at: string;
    expires_at: string;
    cpu: number | null;
    ram_used: string | null;
    ram_total: string | null;
    swap_used?: string | null;
    swap_total?: string | null;
    rx: number | null;
    tx: number | null;
    tcp_inuse?: string | null;
    udp_inuse?: string | null;
    quota: string | null;
    period_rx: string | null;
    period_tx: string | null;
    period_start?: string | null;
    period_end: string | null;
    billing_mode: string;
    traffic_quality?: string[];
  } | null;
  full: {
    sampled_at: string;
    expires_at: string;
    stale: boolean;
    load1: number | null;
    load5: number | null;
    load15: number | null;
    processes?: string | null;
    disk_used: string | null;
    disk_available: string | null;
    disk_total: string | null;
    disk_io?: StatusDiskIO | null;
  } | null;
  lines: ProbeLine[];
  speeds: Speed[];
  metric_trends?: MetricTrends;
};
export type StatusPage = {
  at: string;
  live: boolean;
  nodes: StatusNode[];
  rates: { day: string; quotes: Record<string, { date: string; rate: number }> | null };
};
type StatusNodePatch = Partial<StatusNode> & { speeds_drop?: number; speeds_append?: Speed[] };
export type StatusDelta = {
  at: string;
  nodes?: Record<string, StatusNodePatch>;
  rates?: StatusPage['rates'];
};

export function applyStatusDelta(page: StatusPage, delta: StatusDelta): StatusPage {
  return {
    ...page,
    at: delta.at,
    rates: delta.rates ?? page.rates,
    nodes: page.nodes.map((node) => {
      const patch = delta.nodes?.[node.id];
      if (!patch) return node;
      const { speeds_drop, speeds_append, ...fields } = patch;
      const updated = { ...node, ...fields };
      if (speeds_append) updated.speeds = node.speeds.slice(speeds_drop ?? 0).concat(speeds_append);
      return updated;
    }),
  };
}
export type StatusHistoryRange = '1h' | '6h' | '24h' | '2d' | '7d';
export const statusHistoryRanges: StatusHistoryRange[] = ['1h', '6h', '24h', '2d', '7d'];
export const statusObservationRange = (range: string | null) =>
  statusHistoryRanges.find((value) => value === range) ?? 'live';

export function applyStatusTrends(
  page: StatusPage,
  nodeId: string,
  charts: MetricTrends,
): StatusPage {
  return {
    ...page,
    nodes: page.nodes.map((node) =>
      node.id === nodeId
        ? { ...node, metric_trends: mergeMetricTrends(node.metric_trends, charts) }
        : node,
    ),
  };
}
export type StatusHistory = {
  start: string;
  end: string;
  probe_period: number;
  lines: ProbeLine[];
  charts: MetricTrends;
};
export const readCatalog = (signal?: AbortSignal) =>
  apiRequest<Catalog>('/node-categories', { signal });
export const saveCatalog = (c: Catalog, csrfToken: string) =>
  apiRequest('/node-categories', { method: 'PUT', json: c, csrfToken, responseType: 'void' });
export const assignCategories = (
  revision: number,
  nodes: string[],
  action: string,
  category: string,
  csrfToken: string,
) =>
  apiRequest('/node-categories/members', {
    method: 'PATCH',
    json: { revision, nodes, action, category },
    csrfToken,
    responseType: 'void',
  });
export const readPublication = (signal?: AbortSignal) =>
  apiRequest<Publication>('/settings/status-page', { signal });
export const publishStatus = (p: Publication, csrfToken: string) =>
  apiRequest('/settings/status-page', { method: 'PUT', json: p, csrfToken, responseType: 'void' });
export const previewStatus = (p: Publication, csrfToken: string) =>
  apiRequest<StatusPage>('/settings/status-page/preview', { method: 'POST', json: p, csrfToken });
export const readStatus = (signal?: AbortSignal) => apiRequest<StatusPage>('/status', { signal });
export const readHistory = async (id: string, range: string, signal: AbortSignal) => {
  const value = await apiRequest<StatusHistory>(`/status/nodes/${encodeURIComponent(id)}/history`, {
    query: { range },
    signal,
  });
  if (!value || !isMetricTrends(value.charts)) {
    throw new ApiError('历史指标格式无效，请刷新重试。', 'invalid-response');
  }
  return value;
};
