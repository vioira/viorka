import { describe, expect, it } from 'vitest';
import type { MetricTrend } from './metric-trends';
import {
  applyStatusDelta,
  applyStatusTrends,
  type StatusNode,
  type StatusPage,
} from './public-status';

describe('公开状态增量', () => {
  it('按节点替换变化字段并滚动速率窗口，保留原有顺序和其它节点', () => {
    const point = (second: number) => ({
      at: new Date(second * 1000).toISOString(),
      rx: second,
      tx: null,
    });
    const node: StatusNode = {
      id: 'one',
      alias: '公开节点',
      online: true,
      country: '',
      os: '',
      group: '',
      tags: [],
      ipv4: false,
      ipv6: false,
      ip_at: null,
      uptime: 120,
      uptime_at: point(1).at,
      price: null,
      currency: '',
      months: null,
      expires: null,
      lifetime: null,
      fast: null,
      full: null,
      lines: [],
      speeds: [point(1), point(2)],
    };
    const other = { ...node, id: 'two' };
    const page: StatusPage = {
      at: point(2).at,
      nodes: [other, node],
      rates: { day: '', quotes: null },
      live: true,
    };
    const result = applyStatusDelta(page, {
      at: point(3).at,
      nodes: { one: { uptime: null, speeds_drop: 1, speeds_append: [point(3)] } },
    });
    expect(result.nodes[0]).toBe(other);
    expect(result.nodes[1]).toEqual({ ...node, uptime: null, speeds: [point(2), point(3)] });
    expect(page.nodes[1].speeds).toEqual([point(1), point(2)]);
    expect(result.at).toBe(point(3).at);
    expect(result.rates).toBe(page.rates);
  });

  it('只合并目标节点的曲线，重连基线替换旧点', () => {
    const node = { id: 'one' } as StatusNode;
    const other = { id: 'two' } as StatusNode;
    const page: StatusPage = {
      at: '',
      live: true,
      nodes: [node, other],
      rates: { day: '', quotes: null },
    };
    const point = (id: string, at: number) => ({
      id,
      at: new Date(at).toISOString(),
      source: 'live' as const,
      values: { cpu: at },
    });
    const a = point('a', 1),
      b = point('b', 2),
      c = point('c', 3);
    const cpu: MetricTrend = {
      reset: true,
      period_seconds: 30,
      statistic: 'mean',
      points: [a, b],
      removed_ids: [],
    };
    const seed = applyStatusTrends(page, node.id, { cpu });
    const next = applyStatusTrends(seed, node.id, {
      cpu: { ...cpu, reset: false, points: [c], removed_ids: ['a'] },
    });
    expect(next.nodes[0].metric_trends?.cpu.points).toEqual([b, c]);
    expect(next.nodes[1]).toBe(other);
    expect(applyStatusTrends(next, node.id, { cpu }).nodes[0].metric_trends?.cpu.points).toEqual([
      a,
      b,
    ]);
    expect(seed.nodes[0].metric_trends?.cpu.points).toEqual([a, b]);
  });
});
