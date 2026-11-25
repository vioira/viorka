import { type NodeRecord, nodeRegion } from '@/api/nodes';
import type { Category, Publication, PublishedNode } from '@/api/public-status';

export const MAX_PUBLISHED_NODES = 128;
export const MAX_ALIAS_LENGTH = 96;
export const MAX_CPU_CORES = 65536;

export type PoolFilter = 'all' | 'unselected' | 'online';

export type DraftNode = {
  id: string;
  alias: string;
  cpuCoresInput: string;
};

export function validateAlias(alias: string): string {
  if (!alias.trim()) return '请输入公开别名';
  if (alias !== alias.trim()) return '首尾不能包含空格';
  if (/[\r\n\t\0]/.test(alias)) return '不能包含换行或控制字符';
  if (Array.from(alias).length > MAX_ALIAS_LENGTH) {
    return `公开别名最多 ${MAX_ALIAS_LENGTH} 个字符`;
  }
  return '';
}

export function validateCpuCores(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (!/^\d+$/.test(trimmed)) return `请输入 1 至 ${MAX_CPU_CORES} 的整数`;
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_CPU_CORES) {
    return `请输入 1 至 ${MAX_CPU_CORES} 的整数`;
  }
  return '';
}

export function parseCpuCores(raw: string): number | undefined {
  if (validateCpuCores(raw)) return undefined;
  const trimmed = raw.trim();
  return trimmed ? Number(trimmed) : undefined;
}

export function isDraftNodeValid(node: DraftNode): boolean {
  return !validateAlias(node.alias) && !validateCpuCores(node.cpuCoresInput);
}

export function countInvalidDraftNodes(nodes: DraftNode[]): number {
  let invalid = 0;
  for (const node of nodes) {
    if (!isDraftNodeValid(node)) invalid += 1;
  }
  return invalid;
}

export function fromPublicationNodes(nodes: PublishedNode[]): DraftNode[] {
  return nodes.map((node) => ({
    id: node.id,
    alias: node.alias,
    cpuCoresInput: node.cpu_cores != null ? String(node.cpu_cores) : '',
  }));
}

export function toPublicationNodes(nodes: DraftNode[]): PublishedNode[] {
  return nodes.map((node) => {
    const cpuCores = parseCpuCores(node.cpuCoresInput);
    return cpuCores !== undefined
      ? { id: node.id, alias: node.alias, cpu_cores: cpuCores }
      : { id: node.id, alias: node.alias };
  });
}

export function isPublicationDirty(saved: Publication, draftNodes: DraftNode[]): boolean {
  if (saved.nodes.length !== draftNodes.length) return true;
  for (let i = 0; i < saved.nodes.length; i += 1) {
    const base = saved.nodes[i];
    const current = draftNodes[i];
    if (!current || base.id !== current.id || base.alias !== current.alias) return true;
    if (validateCpuCores(current.cpuCoresInput)) return true;
    const currentCores = parseCpuCores(current.cpuCoresInput);
    if ((base.cpu_cores ?? undefined) !== currentCores) return true;
  }
  return false;
}

export function moveDraftNode(nodes: DraftNode[], fromIndex: number, toIndex: number): DraftNode[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= nodes.length ||
    toIndex >= nodes.length ||
    fromIndex === toIndex
  ) {
    return nodes;
  }
  const next = [...nodes];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) return nodes;
  next.splice(toIndex, 0, moved);
  return next;
}

export function sortDraftNodesByAlias(nodes: DraftNode[]): DraftNode[] {
  return [...nodes].sort((a, b) => a.alias.localeCompare(b.alias, 'zh-CN'));
}

export function sortDraftNodesOnlineFirst(
  nodes: DraftNode[],
  nodeMap: ReadonlyMap<string, NodeRecord>,
): DraftNode[] {
  const rank = (id: string) => {
    const state = nodeMap.get(id)?.state;
    if (state === 'online') return 0;
    if (state === 'offline') return 1;
    return 2;
  };
  return [...nodes].sort((a, b) => rank(a.id) - rank(b.id));
}

export function splitNodeCategories(categories?: Category[]): {
  publicGroup?: Category;
  privateGroup?: Category;
  publicTags: Category[];
} {
  let publicGroup: Category | undefined;
  let privateGroup: Category | undefined;
  const publicTags: Category[] = [];
  for (const cat of categories ?? []) {
    if (cat.kind === 'group') {
      if (cat.shared) publicGroup = cat;
      else privateGroup = cat;
    } else if (cat.kind === 'tag' && cat.shared) {
      publicTags.push(cat);
    }
  }
  return { publicGroup, privateGroup, publicTags };
}

export function matchesPoolFilter(
  node: NodeRecord,
  query: string,
  filter: PoolFilter,
  selectedIds: ReadonlySet<string>,
): boolean {
  if (filter === 'unselected' && selectedIds.has(node.id)) return false;
  if (filter === 'online' && node.state !== 'online') return false;
  const q = query.trim().toLocaleLowerCase();
  if (!q) return true;
  const fields = [
    node.name,
    node.id,
    nodeRegion(node.location),
    node.location?.country_code ?? '',
    ...(node.categories ?? []).map((c) => c.name),
  ];
  return fields.some((value) => value.toLocaleLowerCase().includes(q));
}
