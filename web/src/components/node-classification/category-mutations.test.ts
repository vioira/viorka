import { describe, expect, it, vi } from 'vitest';
import type { NodeRecord } from '@/api/nodes';
import type { Category } from '@/api/public-status';
import {
  applyCategoryOperations,
  buildCategorySteps,
  catalogChanged,
  computeTriStateTags,
  PartialCategoryApplyError,
  validateCategoryDraftName,
} from './category-mutations';

const tagA: Category = { id: 'a', kind: 'tag', name: 'CN2', shared: true };
const tagB: Category = { id: 'b', kind: 'tag', name: 'BGP', shared: false };
const tagC: Category = { id: 'c', kind: 'tag', name: '原生', shared: false };

const baseNode = (id: string, categories: Category[]): NodeRecord => ({
  id,
  name: id,
  kind: 'vps',
  state: 'online',
  last_seen_at: '',
  os: 'debian',
  arch: 'amd64',
  agent_version: '0.4.2',
  categories,
});

describe('category mutations', () => {
  it('validates unique names per kind and length limits', () => {
    const items: Category[] = [tagA, { id: 'g', kind: 'group', name: 'CN2', shared: false }];
    expect(validateCategoryDraftName(items, 'tag', '   ')).toBe('请输入分类名称。');
    expect(validateCategoryDraftName(items, 'tag', 'cn2')).toContain('已存在');
    expect(validateCategoryDraftName(items, 'tag', 'CN2', 'a')).toBeNull();
    expect(validateCategoryDraftName(items, 'group', '新组')).toBeNull();
    expect(validateCategoryDraftName(items, 'tag', 'x'.repeat(65))).toContain('64');
  });

  it('detects catalog draft changes and computes tri-state tags', () => {
    expect(catalogChanged([tagA], [{ ...tagA }])).toBe(false);
    expect(catalogChanged([tagA], [{ ...tagA, shared: false }])).toBe(true);

    const tri = computeTriStateTags(
      [baseNode('1', [tagA, tagB]), baseNode('2', [tagA])],
      [tagA, tagB, tagC],
    );
    expect(tri.map((t) => [t.category.id, t.initial, t.count])).toEqual([
      ['a', 'all', 2],
      ['b', 'mixed', 1],
      ['c', 'none', 0],
    ]);
  });

  it('steps revision across sequential steps, chunks 256 nodes, and reports partial failure', async () => {
    const executor = vi.fn().mockResolvedValue(undefined);
    const steps = buildCategorySteps({ groupId: 'g1', addTagIds: ['t1'], removeTagIds: ['t2'] });
    const ids = Array.from({ length: 260 }, (_, i) => `node-${i}`);

    const nextRev = await applyCategoryOperations({
      revision: 10,
      nodeIds: ids,
      steps,
      csrfToken: 'csrf',
      executor,
    });
    // 3 steps * 2 chunks = 6 calls
    expect(executor).toHaveBeenCalledTimes(6);
    expect(executor.mock.calls[0][0]).toBe(10);
    expect(executor.mock.calls[0][1]).toHaveLength(256);
    expect(executor.mock.calls[1][0]).toBe(11);
    expect(executor.mock.calls[1][1]).toHaveLength(4);
    expect(nextRev).toBe(16);

    const failing = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('版本冲突'));
    await expect(
      applyCategoryOperations({
        revision: 1,
        nodeIds: ['n1'],
        steps: buildCategorySteps({ addTagIds: ['t1', 't2'] }),
        csrfToken: 'csrf',
        executor: failing,
      }),
    ).rejects.toBeInstanceOf(PartialCategoryApplyError);
  });
});
