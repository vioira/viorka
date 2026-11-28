import { isStale } from '@/api/monitoring';
import { nodeKind, nodeRegion } from '@/api/nodes';
import type { Category } from '@/api/public-status';
import { decimalPercent } from '@/api/telemetry';
import type { ListedNode } from '@/hooks/use-nodes';

export type NodeViewMode = 'cards' | 'grouped';
export type NodeSortKey =
  | 'default'
  | 'attention'
  | 'cpu'
  | 'memory'
  | 'traffic'
  | 'expiry'
  | 'name';
export type TagMatchMode = 'all' | 'any';
export type BillingFilter = 'all' | 'soon' | 'expired' | 'migration';

export type NodeFilterState = {
  query: string;
  states: string[];
  group: string;
  tags: string[];
  tagMode: TagMatchMode;
  kind: string;
  country: string;
  engine: string;
  billing: BillingFilter;
  sharedOnly: boolean;
  sort: NodeSortKey;
  view: NodeViewMode;
};

export const defaultNodeFilters: NodeFilterState = {
  query: '',
  states: [],
  group: 'all',
  tags: [],
  tagMode: 'all',
  kind: 'all',
  country: 'all',
  engine: 'all',
  billing: 'all',
  sharedOnly: false,
  sort: 'default',
  view: 'cards',
};

const VALID_STATES = new Set(['online', 'offline', 'pending', 'disabled']);
const VALID_KINDS = new Set(['vps', 'nat']);
const VALID_BILLING = new Set<BillingFilter>(['all', 'soon', 'expired', 'migration']);
const VALID_SORTS = new Set<NodeSortKey>([
  'default',
  'attention',
  'cpu',
  'memory',
  'traffic',
  'expiry',
  'name',
]);
const SEVEN_DAYS_MS = 7 * 86400000;

export function nodeGroup(node: Pick<ListedNode, 'categories'>): Category | undefined {
  return node.categories?.find((c) => c.kind === 'group');
}

export function nodeTags(node: Pick<ListedNode, 'categories'>): Category[] {
  return node.categories?.filter((c) => c.kind === 'tag') ?? [];
}

/** Merge persisted catalog items with any categories already attached to loaded nodes. */
export function mergeCatalogCategories(catalogItems: Category[], nodes: ListedNode[]): Category[] {
  const map = new Map<string, Category>();
  for (const item of catalogItems) map.set(item.id, item);
  for (const node of nodes) {
    for (const item of node.categories ?? []) {
      if (!map.has(item.id)) map.set(item.id, item);
    }
  }
  return [...map.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.name.localeCompare(b.name, 'zh-CN') || a.id.localeCompare(b.id);
  });
}

export function parseNodeFilters(params: URLSearchParams): NodeFilterState {
  const query = params.get('q') ?? '';
  const rawStates = (params.get('state') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => VALID_STATES.has(s));
  const states = [...new Set(rawStates)];
  const group = params.get('group') || 'all';
  const rawTags = (params.get('tag') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const tags = rawTags.includes('none') ? ['none'] : [...new Set(rawTags)];
  const tagMode: TagMatchMode = params.get('tag_mode') === 'any' ? 'any' : 'all';
  const rawKind = params.get('kind') ?? 'all';
  const kind = VALID_KINDS.has(rawKind) ? rawKind : 'all';
  const country = params.get('country') || 'all';
  const engine = params.get('engine') || 'all';
  const rawBilling = (params.get('billing') ?? 'all') as BillingFilter;
  const billing: BillingFilter = VALID_BILLING.has(rawBilling) ? rawBilling : 'all';
  const sharedOnly = params.get('shared') === '1';
  const rawSort = (params.get('sort') ?? 'default') as NodeSortKey;
  const sort: NodeSortKey = VALID_SORTS.has(rawSort) ? rawSort : 'default';
  const view: NodeViewMode = params.get('view') === 'grouped' ? 'grouped' : 'cards';
  return {
    query,
    states,
    group,
    tags,
    tagMode,
    kind,
    country,
    engine,
    billing,
    sharedOnly,
    sort,
    view,
  };
}

export function serializeNodeFilters(filters: NodeFilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.query.trim()) params.set('q', filters.query);
  if (filters.states.length) params.set('state', filters.states.join(','));
  if (filters.group !== 'all') params.set('group', filters.group);
  if (filters.tags.length) params.set('tag', filters.tags.join(','));
  if (filters.tagMode !== 'all' && filters.tags.length > 1) params.set('tag_mode', filters.tagMode);
  if (filters.kind !== 'all') params.set('kind', filters.kind);
  if (filters.country !== 'all') params.set('country', filters.country);
  if (filters.engine !== 'all') params.set('engine', filters.engine);
  if (filters.billing !== 'all') params.set('billing', filters.billing);
  if (filters.sharedOnly) params.set('shared', '1');
  if (filters.sort !== 'default') params.set('sort', filters.sort);
  if (filters.view !== 'cards') params.set('view', filters.view);
  return params;
}

export function hasActiveNodeFilters(filters: NodeFilterState): boolean {
  return Boolean(
    filters.query.trim() ||
      filters.states.length > 0 ||
      filters.group !== 'all' ||
      filters.tags.length > 0 ||
      filters.kind !== 'all' ||
      filters.country !== 'all' ||
      filters.engine !== 'all' ||
      filters.billing !== 'all' ||
      filters.sharedOnly,
  );
}

export function clearNodeFilters(filters: NodeFilterState): NodeFilterState {
  return { ...defaultNodeFilters, view: filters.view };
}

function liveCpu(node: ListedNode, now: number): number | null {
  const summary = node.metricSummary;
  const fast = node.monitoring?.telemetry?.fast;
  const stale =
    node.state !== 'online' ||
    (summary ? now >= Date.parse(summary.expires_at) : isStale(node.monitoring, now));
  if (stale) return null;
  if (summary) return summary.cpu;
  if (fast?.errors.includes('cpu_unavailable')) return null;
  return fast?.cpu_percent ?? null;
}

function liveMemory(node: ListedNode, now: number): number | null {
  const summary = node.metricSummary;
  const fast = node.monitoring?.telemetry?.fast;
  const stale =
    node.state !== 'online' ||
    (summary ? now >= Date.parse(summary.expires_at) : isStale(node.monitoring, now));
  if (stale || (!summary && fast?.errors.includes('memory_unavailable'))) return null;
  if (summary) return summary.memory;
  return decimalPercent(fast?.ram_used, fast?.ram_total);
}

function liveTrafficGb(node: ListedNode, now: number): number | null {
  const record = node.metricSummary
    ? node.metricSummary.daily_traffic
    : node.monitoring?.telemetry?.daily_traffic;
  if (!record) return null;
  if (now < Date.parse(record.day_start) || now >= Date.parse(record.day_end)) return null;
  return Number(BigInt(record.rx_bytes) + BigInt(record.tx_bytes)) / 1e9;
}

function expiryMs(node: ListedNode): number {
  const raw = node.billing?.expires_at;
  if (!raw) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

const STATE_RANK: Record<string, number> = {
  offline: 0,
  pending: 1,
  disabled: 2,
  online: 3,
};

export function sortNodes(nodes: ListedNode[], sort: NodeSortKey, now: number): ListedNode[] {
  if (sort === 'default') return nodes;
  const list = [...nodes];
  if (sort === 'attention') {
    return list.sort((a, b) => {
      const rankDiff = (STATE_RANK[a.state] ?? 4) - (STATE_RANK[b.state] ?? 4);
      if (rankDiff !== 0) return rankDiff;
      const migA = a.origin_migration && a.origin_migration !== 'confirmed' ? 0 : 1;
      const migB = b.origin_migration && b.origin_migration !== 'confirmed' ? 0 : 1;
      if (migA !== migB) return migA - migB;
      return expiryMs(a) - expiryMs(b);
    });
  }
  if (sort === 'cpu') {
    return list.sort((a, b) => (liveCpu(b, now) ?? -1) - (liveCpu(a, now) ?? -1));
  }
  if (sort === 'memory') {
    return list.sort((a, b) => (liveMemory(b, now) ?? -1) - (liveMemory(a, now) ?? -1));
  }
  if (sort === 'traffic') {
    return list.sort((a, b) => (liveTrafficGb(b, now) ?? -1) - (liveTrafficGb(a, now) ?? -1));
  }
  if (sort === 'expiry') {
    return list.sort((a, b) => expiryMs(a) - expiryMs(b));
  }
  if (sort === 'name') {
    return list.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, 'zh-CN'));
  }
  return list;
}

export function matchesNodeFilters(
  node: ListedNode,
  filters: NodeFilterState,
  now: number,
): boolean {
  if (filters.states.length && !filters.states.includes(node.state)) return false;

  const group = nodeGroup(node);
  if (filters.group === 'none') {
    if (group) return false;
  } else if (filters.group !== 'all') {
    if (!group || group.id !== filters.group) return false;
  }

  const tags = nodeTags(node);
  if (filters.tags.length) {
    if (filters.tags.includes('none')) {
      if (tags.length > 0) return false;
    } else {
      const tagSet = new Set(tags.map((t) => t.id));
      const matched =
        filters.tagMode === 'all'
          ? filters.tags.every((id) => tagSet.has(id))
          : filters.tags.some((id) => tagSet.has(id));
      if (!matched) return false;
    }
  }

  if (filters.kind !== 'all' && node.kind !== filters.kind) return false;

  if (filters.country !== 'all') {
    const code = node.location?.country_code || '';
    if (code !== filters.country) return false;
  }

  if (filters.engine !== 'all') {
    if (filters.engine === 'none') {
      if (!node.engines || node.engines.length > 0) return false;
    } else if (!node.engines?.some((e) => e.name.toLowerCase() === filters.engine.toLowerCase())) {
      return false;
    }
  }

  if (filters.billing !== 'all') {
    if (filters.billing === 'migration') {
      if (!node.origin_migration || node.origin_migration === 'confirmed') return false;
    } else {
      const expiresAt = node.billing?.expires_at;
      if (!expiresAt) return false;
      const ms = Date.parse(expiresAt);
      if (!Number.isFinite(ms)) return false;
      if (filters.billing === 'expired' && ms > now) return false;
      if (filters.billing === 'soon' && (ms <= now || ms - now > SEVEN_DAYS_MS)) return false;
    }
  }

  if (filters.sharedOnly && !node.categories?.some((c) => c.shared)) return false;

  const q = filters.query.trim().toLocaleLowerCase();
  if (q) {
    const haystack = [
      node.id,
      node.name,
      nodeKind(node.kind),
      nodeRegion(node.location),
      node.inventory?.os_name || node.os,
      node.inventory?.public_ipv4 || '',
      node.inventory?.public_ipv6 || '',
      group ? group.name : '未分组',
      ...tags.map((t) => t.name),
    ]
      .join(' ')
      .toLocaleLowerCase();
    if (!haystack.includes(q)) return false;
  }

  return true;
}

export type NodeFacetCounts = {
  total: number;
  states: Record<'online' | 'offline' | 'pending' | 'disabled', number>;
  ungrouped: number;
  groups: Record<string, number>;
  untagged: number;
  tags: Record<string, number>;
  kinds: Record<'vps' | 'nat', number>;
  countries: { code: string; label: string; count: number }[];
  engines: { name: string; label: string; count: number }[];
  billing: Record<'soon' | 'expired' | 'migration', number>;
};

const ENGINE_DISPLAY: Record<string, string> = {
  'sing-box': 'sing-box',
  xray: 'Xray',
  realm: 'Realm',
};

const regionDisplay = new Intl.DisplayNames(['zh-CN'], { type: 'region' });

export function countNodeFacets(
  nodes: ListedNode[],
  categories: Category[],
  now: number,
): NodeFacetCounts {
  const counts: NodeFacetCounts = {
    total: nodes.length,
    states: { online: 0, offline: 0, pending: 0, disabled: 0 },
    ungrouped: 0,
    groups: {},
    untagged: 0,
    tags: {},
    kinds: { vps: 0, nat: 0 },
    countries: [],
    engines: [],
    billing: { soon: 0, expired: 0, migration: 0 },
  };

  for (const cat of categories) {
    if (cat.kind === 'group') counts.groups[cat.id] = 0;
    else counts.tags[cat.id] = 0;
  }

  const countryMap = new Map<string, number>();
  const engineMap = new Map<string, number>();

  for (const node of nodes) {
    if (node.state in counts.states) {
      counts.states[node.state as keyof typeof counts.states] += 1;
    }
    if (node.kind === 'vps' || node.kind === 'nat') {
      counts.kinds[node.kind] += 1;
    }

    const group = nodeGroup(node);
    if (group) counts.groups[group.id] = (counts.groups[group.id] ?? 0) + 1;
    else counts.ungrouped += 1;

    const tags = nodeTags(node);
    if (tags.length === 0) counts.untagged += 1;
    for (const tag of tags) {
      counts.tags[tag.id] = (counts.tags[tag.id] ?? 0) + 1;
    }

    const code = node.location?.country_code || '';
    if (code) countryMap.set(code, (countryMap.get(code) ?? 0) + 1);

    if (node.engines) {
      if (node.engines.length === 0) {
        engineMap.set('none', (engineMap.get('none') ?? 0) + 1);
      } else {
        for (const e of node.engines) {
          const key = e.name.toLowerCase();
          engineMap.set(key, (engineMap.get(key) ?? 0) + 1);
        }
      }
    }

    if (node.origin_migration && node.origin_migration !== 'confirmed') {
      counts.billing.migration += 1;
    }
    if (node.billing?.expires_at) {
      const ms = Date.parse(node.billing.expires_at);
      if (Number.isFinite(ms)) {
        if (ms <= now) counts.billing.expired += 1;
        else if (ms - now <= SEVEN_DAYS_MS) counts.billing.soon += 1;
      }
    }
  }

  counts.countries = [...countryMap.entries()]
    .map(([code, count]) => ({
      code,
      label: regionDisplay.of(code) ?? code,
      count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'));

  counts.engines = [...engineMap.entries()]
    .map(([name, count]) => ({
      name,
      label: name === 'none' ? '未安装引擎' : (ENGINE_DISPLAY[name] ?? name),
      count,
    }))
    .sort((a, b) =>
      a.name === 'none' ? 1 : b.name === 'none' ? -1 : a.label.localeCompare(b.label),
    );

  return counts;
}

export type NodeGroupBucket = {
  id: string;
  name: string;
  shared: boolean;
  nodes: ListedNode[];
};

export function groupNodesByCategory(
  nodes: ListedNode[],
  categories: Category[],
): NodeGroupBucket[] {
  const groups = categories.filter((c) => c.kind === 'group');
  const byGroup = new Map<string, ListedNode[]>();
  const ungrouped: ListedNode[] = [];

  for (const node of nodes) {
    const group = nodeGroup(node);
    if (!group) {
      ungrouped.push(node);
    } else {
      const list = byGroup.get(group.id) ?? [];
      list.push(node);
      byGroup.set(group.id, list);
    }
  }

  const buckets: NodeGroupBucket[] = [];
  for (const group of groups) {
    const list = byGroup.get(group.id);
    if (list?.length) {
      buckets.push({ id: group.id, name: group.name, shared: group.shared, nodes: list });
    }
  }
  if (ungrouped.length) {
    buckets.push({ id: 'none', name: '未分组', shared: false, nodes: ungrouped });
  }
  return buckets;
}
