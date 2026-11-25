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
  parseCpuCores,
  sortDraftNodesByAlias,
  sortDraftNodesOnlineFirst,
  splitNodeCategories,
  toPublicationNodes,
  validateAlias,
  validateCpuCores,
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

  it('validates and parses optional CPU cores in 1..65536', () => {
    expect(validateCpuCores('')).toBe('');
    expect(validateCpuCores('1')).toBe('');
    expect(validateCpuCores('65536')).toBe('');
    expect(validateCpuCores('0')).not.toBe('');
    expect(validateCpuCores('-2')).not.toBe('');
    expect(validateCpuCores('2.5')).not.toBe('');
    expect(validateCpuCores('65537')).not.toBe('');
    expect(validateCpuCores('abc')).not.toBe('');

    expect(parseCpuCores('')).toBeUndefined();
    expect(parseCpuCores('8')).toBe(8);
    expect(parseCpuCores('0')).toBeUndefined();
  });

  it('converts between Publication nodes and DraftNode and tracks dirty state', () => {
    const saved: Publication = {
      revision: 3,
      enabled: true,
      nodes: [
        { id: 'n1', alias: '节点一', cpu_cores: 4 },
        { id: 'n2', alias: '节点二' },
      ],
    };
    const drafts = fromPublicationNodes(saved.nodes);
    expect(drafts).toEqual([
      { id: 'n1', alias: '节点一', cpuCoresInput: '4' },
      { id: 'n2', alias: '节点二', cpuCoresInput: '' },
    ]);
    expect(isPublicationDirty(saved, drafts)).toBe(false);
    expect(toPublicationNodes(drafts)).toEqual(saved.nodes);

    expect(
      isPublicationDirty(saved, [
        { id: 'n1', alias: '节点一改', cpuCoresInput: '4' },
        { id: 'n2', alias: '节点二', cpuCoresInput: '' },
      ]),
    ).toBe(true);

    expect(
      isPublicationDirty(saved, [
        { id: 'n1', alias: '节点一', cpuCoresInput: '0' },
        { id: 'n2', alias: '节点二', cpuCoresInput: '' },
      ]),
    ).toBe(true);

    expect(
      isPublicationDirty(saved, [
        { id: 'n2', alias: '节点二', cpuCoresInput: '' },
        { id: 'n1', alias: '节点一', cpuCoresInput: '4' },
      ]),
    ).toBe(true);
  });

  it('counts invalid draft entries accurately', () => {
    expect(
      countInvalidDraftNodes([
        { id: 'n1', alias: 'OK', cpuCoresInput: '4' },
        { id: 'n2', alias: '', cpuCoresInput: '' },
        { id: 'n3', alias: 'Valid', cpuCoresInput: '0' },
      ]),
    ).toBe(2);
  });

  it('reorders and sorts draft nodes predictably', () => {
    const items = [
      { id: 'c', alias: '新加坡', cpuCoresInput: '' },
      { id: 'a', alias: '东京', cpuCoresInput: '' },
      { id: 'b', alias: '大阪', cpuCoresInput: '' },
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
