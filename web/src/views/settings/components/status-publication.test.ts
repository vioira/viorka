import { describe, expect, it } from 'vitest';
import type { NodeRecord } from '@/api/nodes';
import type { Category, Publication } from '@/api/public-status';
import {
  countInvalidDraftNodes,
  fromPublicationNodes,
  isPublicationDirty,
  MAX_ALIAS_LENGTH,
  matchesPoolFilter,
  moveDraftNode,
  sortDraftNodesByAlias,
  sortDraftNodesOnlineFirst,
  splitNodeCategories,
  toPublicationNodes,
  validateAlias,
} from './status-publication';

function makeNode(overrides: Partial<NodeRecord> = {}): NodeRecord {
  return {
    id: 'node-1',
    name: '东京-01',
    kind: 'vps',
    state: 'online',
    last_seen_at: '2026-11-25T00:00:00Z',
    os: 'debian',
    arch: 'amd64',
    agent_version: '0.4.2',
    ...overrides,
  };
}

describe('status-publication helpers', () => {
  it('validates aliases matching backend statusName rules', () => {
    expect(validateAlias('Tokyo Edge')).toBe('');
    expect(validateAlias('')).toBe('请输入公开别名');
    expect(validateAlias('   ')).toBe('请输入公开别名');
    expect(validateAlias(' Tokyo')).toBe('首尾不能包含空格');
    expect(validateAlias('Tokyo ')).toBe('首尾不能包含空格');
    expect(validateAlias('Tokyo\nEdge')).toBe('不能包含换行或控制字符');
    expect(validateAlias('节'.repeat(MAX_ALIAS_LENGTH))).toBe('');
    expect(validateAlias('节'.repeat(MAX_ALIAS_LENGTH + 1))).toContain(`${MAX_ALIAS_LENGTH}`);
  });

  it('converts between Publication nodes and DraftNode and tracks dirty state', () => {
    const saved: Publication = {
      revision: 3,
      enabled: true,
      nodes: [
        { id: 'n1', alias: '节点一' },
        { id: 'n2', alias: '节点二' },
      ],
    };
    const drafts = fromPublicationNodes(saved.nodes);
    expect(drafts).toEqual([
      { id: 'n1', alias: '节点一' },
      { id: 'n2', alias: '节点二' },
    ]);
    expect(isPublicationDirty(saved, drafts)).toBe(false);
    expect(toPublicationNodes(drafts)).toEqual(drafts);

    expect(
      isPublicationDirty(saved, [
        { id: 'n1', alias: '节点一改' },
        { id: 'n2', alias: '节点二' },
      ]),
    ).toBe(true);

    expect(
      isPublicationDirty(saved, [
        { id: 'n1', alias: '节点一' },
        { id: 'n2', alias: '节点二' },
      ]),
    ).toBe(false);

    expect(
      isPublicationDirty(saved, [
        { id: 'n2', alias: '节点二' },
        { id: 'n1', alias: '节点一' },
      ]),
    ).toBe(true);
  });

  it('counts invalid draft entries accurately', () => {
    expect(
      countInvalidDraftNodes([
        { id: 'n1', alias: 'OK' },
        { id: 'n2', alias: '' },
        { id: 'n3', alias: '' },
      ]),
    ).toBe(2);
  });

  it('reorders and sorts draft nodes predictably', () => {
    const items = [
      { id: 'c', alias: '新加坡' },
      { id: 'a', alias: '东京' },
      { id: 'b', alias: '大阪' },
    ];
    expect(moveDraftNode(items, 2, 0).map((n) => n.id)).toEqual(['b', 'c', 'a']);
    expect(moveDraftNode(items, -1, 0)).toBe(items);
    expect(sortDraftNodesByAlias(items).map((n) => n.id)).toEqual(['b', 'a', 'c']);

    const nodeMap = new Map<string, NodeRecord>([
      ['a', makeNode({ id: 'a', state: 'offline' })],
      ['b', makeNode({ id: 'b', state: 'online' })],
      ['c', makeNode({ id: 'c', state: 'pending' })],
    ]);
    expect(sortDraftNodesOnlineFirst(items, nodeMap).map((n) => n.id)).toEqual(['b', 'a', 'c']);
  });

  it('splits shared and unshared categories and filters pool nodes', () => {
    const categories: Category[] = [
      { id: 'g1', kind: 'group', name: '生产线路', shared: true },
      { id: 't1', kind: 'tag', name: 'CN2', shared: true },
      { id: 't2', kind: 'tag', name: '内部测试', shared: false },
    ];
    const split = splitNodeCategories(categories);
    expect(split.publicGroup?.name).toBe('生产线路');
    expect(split.privateGroup).toBeUndefined();
    expect(split.publicTags.map((t) => t.name)).toEqual(['CN2']);

    const node = makeNode({
      id: 'n-jp',
      name: 'JP-Tokyo',
      state: 'online',
      location: { country_code: 'JP', subdivision: '', city: 'Tokyo' },
      categories,
    });
    const selected = new Set(['n-jp']);
    expect(matchesPoolFilter(node, '', 'all', selected)).toBe(true);
    expect(matchesPoolFilter(node, '', 'unselected', selected)).toBe(false);
    expect(matchesPoolFilter(node, '生产', 'online', new Set())).toBe(true);
    expect(matchesPoolFilter(node, '美国', 'all', new Set())).toBe(false);
  });
});
