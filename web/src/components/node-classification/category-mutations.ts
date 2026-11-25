import type { NodeRecord } from '@/api/nodes';
import { assignCategories, type Category } from '@/api/public-status';

export const MAX_CATEGORY_ITEMS = 256;
export const MAX_CATEGORY_NAME_LENGTH = 64;
export const MAX_ASSIGN_NODES = 256;

export function createCategoryId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `cat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function validateCategoryDraftName(
  items: Category[],
  kind: Category['kind'],
  rawName: string,
  excludeId?: string,
): string | null {
  const name = rawName.trim();
  if (!name) return '请输入分类名称。';
  if (Array.from(name).length > MAX_CATEGORY_NAME_LENGTH) {
    return `分类名称不能超过 ${MAX_CATEGORY_NAME_LENGTH} 个字符。`;
  }
  if (/[\r\n\t\0]/.test(name)) {
    return '分类名称不能包含换行或控制字符。';
  }
  const key = name.toLocaleLowerCase();
  const dup = items.find(
    (item) =>
      item.kind === kind && item.id !== excludeId && item.name.trim().toLocaleLowerCase() === key,
  );
  if (dup) {
    return `${kind === 'group' ? '分组' : '标签'}“${name}”已存在。`;
  }
  return null;
}

export function catalogChanged(saved: Category[], draft: Category[]): boolean {
  if (saved.length !== draft.length) return true;
  const byId = new Map(saved.map((item) => [item.id, item]));
  return draft.some((item) => {
    const prev = byId.get(item.id);
    return (
      !prev || prev.kind !== item.kind || prev.name !== item.name || prev.shared !== item.shared
    );
  });
}

export type TriStateValue = 'all' | 'mixed' | 'none';

export type TagTriState = {
  category: Category;
  initial: TriStateValue;
  count: number;
};

export function computeTriStateTags(nodes: NodeRecord[], tags: Category[]): TagTriState[] {
  return tags.map((category) => {
    const count = nodes.filter((node) =>
      node.categories?.some((c) => c.id === category.id && c.kind === 'tag'),
    ).length;
    const initial: TriStateValue = count === 0 ? 'none' : count === nodes.length ? 'all' : 'mixed';
    return { category, initial, count };
  });
}

export type CategoryMutationStep = {
  action: 'group' | 'add' | 'remove';
  category: string;
};

export function buildCategorySteps(options: {
  groupId?: string;
  addTagIds?: string[];
  removeTagIds?: string[];
}): CategoryMutationStep[] {
  const steps: CategoryMutationStep[] = [];
  if (options.groupId !== undefined) {
    steps.push({ action: 'group', category: options.groupId });
  }
  for (const id of options.addTagIds ?? []) {
    steps.push({ action: 'add', category: id });
  }
  for (const id of options.removeTagIds ?? []) {
    steps.push({ action: 'remove', category: id });
  }
  return steps;
}

export class PartialCategoryApplyError extends Error {
  constructor(
    message: string,
    public readonly appliedSteps: number,
    public readonly totalSteps: number,
    public readonly causeError: unknown,
  ) {
    super(message);
    this.name = 'PartialCategoryApplyError';
  }
}

/**
 * Apply group and tag mutations sequentially using optimistic category_revision stepping.
 * Chunks node IDs at 256 per backend CategoryAssignment limits.
 */
export async function applyCategoryOperations(params: {
  revision: number;
  nodeIds: string[];
  steps: CategoryMutationStep[];
  csrfToken: string;
  executor?: typeof assignCategories;
}): Promise<number> {
  const { nodeIds, steps, csrfToken, executor = assignCategories } = params;
  if (!nodeIds.length || !steps.length) return params.revision;

  let revision = params.revision;
  let applied = 0;

  const chunks: string[][] = [];
  for (let i = 0; i < nodeIds.length; i += MAX_ASSIGN_NODES) {
    chunks.push(nodeIds.slice(i, i + MAX_ASSIGN_NODES));
  }
  const totalRequests = steps.length * chunks.length;

  for (const step of steps) {
    for (const chunk of chunks) {
      try {
        await executor(revision, chunk, step.action, step.category, csrfToken);
        revision += 1;
        applied += 1;
      } catch (cause) {
        if (applied > 0) {
          const base = cause instanceof Error ? cause.message : '部分更新未完成。';
          throw new PartialCategoryApplyError(
            `${base} 已完成 ${applied} / ${totalRequests} 项变更，请刷新后核对当前结果。`,
            applied,
            totalRequests,
            cause,
          );
        }
        throw cause;
      }
    }
  }
  return revision;
}
