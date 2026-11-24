import { apiRequest } from './client';

export type Category = { id: string; kind: 'group' | 'tag'; name: string; shared: boolean };
export type Catalog = { revision: number; items: Category[] };
export type PublishedNode = { id: string; alias: string; cpu_cores?: number };
export type Publication = { revision: number; enabled: boolean; nodes: PublishedNode[] };
export type ProbePoint = { at: string; ping: number; loss: number };
export type ProbeLine = {
  slot: number;
  name: string;
  latest: ProbePoint | null;
  history: ProbePoint[];
};
export type Speed = { at: string; rx: number | null; tx: number | null };
export type StatusNode = PublishedNode & {
  online: boolean;
  country: string;
  os: string;
  group: string;
  tags: string[];
  ipv4: boolean;
  ipv6: boolean;
  ip_at: string | null;
  uptime: number | null;
  uptime_at: string | null;
  price: string | null;
  currency: string;
  months: number | null;
  expires: string | null;
  lifetime: { start: string; rx: string; tx: string; partial: boolean } | null;
  fast: {
    sampled_at: string;
    expires_at: string;
    cpu: number | null;
    ram_used: string | null;
    ram_total: string | null;
    rx: number | null;
    tx: number | null;
    quota: string | null;
    period_rx: string | null;
    period_tx: string | null;
    period_end: string | null;
    billing_mode: string;
  } | null;
  full: {
    sampled_at: string;
    stale: boolean;
    load1: number | null;
    load5: number | null;
    load15: number | null;
    disk_used: string | null;
    disk_available: string | null;
    disk_total: string | null;
  } | null;
  lines: ProbeLine[];
  speeds: Speed[];
};
export type StatusPage = {
  at: string;
  live: boolean;
  nodes: StatusNode[];
  rates: { day: string; quotes: Record<string, { date: string; rate: number }> | null };
};
export type StatusHistory = {
  start: string;
  end: string;
  probe_period: number;
  lines: ProbeLine[];
  charts: Record<string, { points: { at: string; values: Record<string, number | null> }[] }>;
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
export const readHistory = (id: string, range: string, signal: AbortSignal) =>
  apiRequest<StatusHistory>(`/status/nodes/${encodeURIComponent(id)}/history`, {
    query: { range },
    signal,
  });
