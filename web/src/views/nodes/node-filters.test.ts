import { describe, expect, it } from 'vitest';
import type { Category } from '@/api/public-status';
import type { ListedNode } from '@/hooks/use-nodes';
import {
  clearNodeFilters,
  countNodeFacets,
  defaultNodeFilters,
  groupNodesByCategory,
  hasActiveNodeFilters,
  matchesNodeFilters,
  mergeCatalogCategories,
  parseNodeFilters,
  serializeNodeFilters,
} from './node-filters';

const now = Date.parse('2026-11-25T00:00:00Z');

const grpProd: Category = { id: 'grp-prod', kind: 'group', name: '生产主力', shared: true };
const grpBackup: Category = { id: 'grp-bak', kind: 'group', name: '备用', shared: false };
const tagCn2: Category = { id: 'tag-cn2', kind: 'tag', name: 'CN2', shared: true };
const tagBgp: Category = { id: 'tag-bgp', kind: 'tag', name: 'BGP', shared: false };

const nodes: ListedNode[] = [
  {
    id: 'n1',
    name: '东京入口',
    kind: 'vps',
    state: 'online',
    last_seen_at: '2026-11-25T00:00:00Z',
    os: 'debian',
    arch: 'amd64',
    agent_version: '0.4.2',
    location: { country_code: 'JP', subdivision: '', city: '东京' },
    inventory: {
      sampled_at: '2026-11-25T00:00:00Z',
      os_id: 'debian',
      os_name: 'Debian 13',
      os_version: '13',
      public_ipv4: '203.0.113.10',
      public_ipv6: '',
      errors: [],
    },
    engines: [{ name: 'sing-box', version: '1.14' }],
    billing: {
      revision: 1,
      currency: 'CNY',
      price: '68',
      period_months: 1,
      expires_at: '2026-11-28T00:00:00Z',
    },
    categories: [grpProd, tagCn2, tagBgp],
  },
  {
    id: 'n2',
    name: '首尔备机',
    kind: 'nat',
    state: 'offline',
    last_seen_at: '2026-11-24T00:00:00Z',
    os: 'alpine',
    arch: 'arm64',
    agent_version: '0.4.1',
    location: { country_code: 'KR', subdivision: '', city: '首尔' },
    origin_migration: 'pending',
    engines: [],
    billing: {
      revision: 1,
      currency: 'CNY',
      price: '20',
      period_months: 1,
      expires_at: '2026-11-20T00:00:00Z',
    },
    categories: [tagBgp],
  },
  {
    id: 'n3',
    name: '未注册节点',
    kind: 'nat',
    state: 'pending',
    last_seen_at: '',
    os: '',
    arch: '',
    agent_version: '',
    categories: [],
  },
];

describe('node filters', () => {
  it('round-trips non-default filter parameters in URLSearchParams', () => {
    const state = {
      ...defaultNodeFilters,
      query: '203.0.113',
      states: ['online', 'pending'],
      group: 'grp-prod',
      tags: ['tag-cn2', 'tag-bgp'],
      tagMode: 'any' as const,
      kind: 'nat',
      country: 'JP',
      engine: 'sing-box',
      billing: 'soon' as const,
      sharedOnly: true,
      view: 'grouped' as const,
    };
    const serialized = serializeNodeFilters(state);
    expect(parseNodeFilters(serialized)).toEqual(state);
    expect(hasActiveNodeFilters(state)).toBe(true);
    const cleared = clearNodeFilters(state);
    expect(hasActiveNodeFilters(cleared)).toBe(false);
    expect(cleared.view).toBe('grouped');
  });

  it('matches multi-state, group/none, multi-tag AND/OR, search across IP/categories, and billing', () => {
    expect(
      nodes
        .filter((n) =>
          matchesNodeFilters(n, { ...defaultNodeFilters, states: ['offline', 'pending'] }, now),
        )
        .map((n) => n.id),
    ).toEqual(['n2', 'n3']);

    expect(
      nodes
        .filter((n) => matchesNodeFilters(n, { ...defaultNodeFilters, group: 'none' }, now))
        .map((n) => n.id),
    ).toEqual(['n2', 'n3']);

    expect(
      nodes
        .filter((n) =>
          matchesNodeFilters(
            n,
            { ...defaultNodeFilters, tags: ['tag-cn2', 'tag-bgp'], tagMode: 'all' },
            now,
          ),
        )
        .map((n) => n.id),
    ).toEqual(['n1']);

    expect(
      nodes
        .filter((n) =>
          matchesNodeFilters(
            n,
            { ...defaultNodeFilters, tags: ['tag-cn2', 'tag-bgp'], tagMode: 'any' },
            now,
          ),
        )
        .map((n) => n.id),
    ).toEqual(['n1', 'n2']);

    expect(
      nodes
        .filter((n) => matchesNodeFilters(n, { ...defaultNodeFilters, tags: ['none'] }, now))
        .map((n) => n.id),
    ).toEqual(['n3']);

    expect(
      nodes
        .filter((n) => matchesNodeFilters(n, { ...defaultNodeFilters, query: '203.0.113.10' }, now))
        .map((n) => n.id),
    ).toEqual(['n1']);

    expect(
      nodes
        .filter((n) => matchesNodeFilters(n, { ...defaultNodeFilters, billing: 'soon' }, now))
        .map((n) => n.id),
    ).toEqual(['n1']);

    expect(
      nodes
        .filter((n) => matchesNodeFilters(n, { ...defaultNodeFilters, billing: 'expired' }, now))
        .map((n) => n.id),
    ).toEqual(['n2']);

    expect(
      nodes
        .filter((n) => matchesNodeFilters(n, { ...defaultNodeFilters, billing: 'migration' }, now))
        .map((n) => n.id),
    ).toEqual(['n2']);

    expect(
      nodes
        .filter((n) => matchesNodeFilters(n, { ...defaultNodeFilters, engine: 'none' }, now))
        .map((n) => n.id),
    ).toEqual(['n2']);
  });

  it('computes facet counts including empty catalog entries and groups nodes consistently', () => {
    const merged = mergeCatalogCategories([grpBackup, grpProd, tagCn2, tagBgp], nodes);
    const counts = countNodeFacets(nodes, merged, now);
    expect(counts.states).toEqual({ online: 1, offline: 1, pending: 1, disabled: 0 });
    expect(counts.ungrouped).toBe(2);
    expect(counts.groups['grp-prod']).toBe(1);
    expect(counts.groups['grp-bak']).toBe(0);
    expect(counts.untagged).toBe(1);
    expect(counts.tags['tag-bgp']).toBe(2);
    expect(counts.billing).toEqual({ soon: 1, expired: 1, migration: 1 });

    const buckets = groupNodesByCategory(nodes, merged);
    expect(buckets.map((b) => [b.id, b.nodes.length])).toEqual([
      ['grp-prod', 1],
      ['none', 2],
    ]);
  });
});
