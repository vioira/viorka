import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { MetricTrends } from '@/api/metric-trends';
import type { StatusNode, StatusPage } from '@/api/public-status';
import { MetricTrendView } from '@/views/nodes/components/NodeMetricHistory';
import DetailWorkspace from './components/DetailWorkspace';
import { statusMetricCharts, statusProbeHistoryBlocks } from './status-charts';

const now = Date.parse('2026-11-25T12:00:00Z');
const node: StatusNode = {
  id: 'n1',
  alias: 'Tokyo Edge',
  cpu_cores: 4,
  online: true,
  kind: 'vps',
  country: 'JP',
  subdivision: 'Tokyo',
  city: 'Chiyoda',
  os: 'Debian GNU/Linux 12',
  arch: 'amd64',
  group: '亚太优选',
  tags: ['CN2', 'IPv6'],
  ipv4: true,
  ipv6: true,
  ip_at: '2026-11-25T11:50:00Z',
  last_seen_at: '2026-11-25T11:59:50Z',
  uptime: 90060,
  uptime_at: '2026-11-25T11:59:50Z',
  price: '10',
  currency: 'USD',
  months: 1,
  expires: '2026-12-20T00:00:00Z',
  lifetime: { start: '2026-01-01T00:00:00Z', rx: '1000000000', tx: '2000000000', partial: false },
  daily: {
    day_start: '2026-11-25T00:00:00Z',
    day_end: '2026-11-26T00:00:00Z',
    rx_bytes: '500000000',
    tx_bytes: '800000000',
    sampled_at: '2026-11-25T11:59:50Z',
    quality: 0,
  },
  fast: {
    sampled_at: '2026-11-25T11:59:50Z',
    expires_at: '2026-11-25T12:05:00Z',
    cpu: 24.5,
    ram_used: '2000000000',
    ram_total: '8000000000',
    swap_used: '100000000',
    swap_total: '2000000000',
    rx: 1250000,
    tx: 2500000,
    tcp_inuse: '180',
    udp_inuse: '24',
    quota: '1000000000000',
    period_rx: '100000000000',
    period_tx: '200000000000',
    period_start: '2026-11-01T00:00:00Z',
    period_end: '2026-12-01T00:00:00Z',
    billing_mode: 'both',
  },
  full: {
    sampled_at: '2026-11-25T11:59:00Z',
    expires_at: '2026-11-25T12:02:00Z',
    stale: false,
    load1: 0.42,
    load5: 0.38,
    load15: 0.31,
    processes: '142',
    disk_used: '20000000000',
    disk_available: '60000000000',
    disk_total: '80000000000',
    disk_io: {
      read_bytes_per_second: 1024000,
      write_bytes_per_second: 512000,
      quality: [],
    },
  },
  lines: [
    {
      slot: 1,
      name: '电信直连',
      latest: { at: '2026-11-25T11:59:00Z', ping: 45.2, loss: 0 },
      history: [{ at: '2026-11-25T11:58:00Z', ping: 44.8, loss: 0 }],
    },
  ],
  speeds: [{ at: '2026-11-25T11:59:50Z', rx: 1250000, tx: 2500000 }],
};

const trendKey = (k: string) =>
  k === 'network'
    ? 'rx'
    : k === 'disk_io'
      ? 'disk_read'
      : k === 'load'
        ? 'load_one'
        : k === 'connections'
          ? 'tcp_sockets'
          : k;

const sampleTrends: MetricTrends = Object.fromEntries(
  ['cpu', 'memory', 'network', 'connections', 'load', 'disk', 'disk_io', 'processes'].map((k) => [
    k,
    {
      reset: true,
      period_seconds: 30,
      statistic: 'mean' as const,
      removed_ids: [],
      points: [
        {
          id: 'p1',
          at: '2026-11-25T11:59:00Z',
          source: 'history' as const,
          values: { [trendKey(k)]: 12 },
        },
      ],
    },
  ]),
);

const rates: StatusPage['rates'] = {
  day: '2026-11-25',
  quotes: { CNY: { date: '2026-11-25', rate: 7.2 } },
};

describe('公开节点状态详情与 8 图表复用', () => {
  it('将公开节点映射为完整的 8 项指标抬头并处理过期未知态', () => {
    const charts = statusMetricCharts(node, now);
    const visible = charts.filter((c) => !c.key.startsWith('disk_io') || c.key === 'disk_io');
    expect(visible.map((c) => c.key)).toEqual([
      'cpu',
      'memory',
      'network',
      'load',
      'connections',
      'disk',
      'disk_io',
      'processes',
    ]);
    expect(visible.find((c) => c.key === 'cpu')?.value).toBe('24.5%');
    expect(visible.find((c) => c.key === 'memory')?.detail).toContain('Swap');
    expect(visible.find((c) => c.key === 'connections')?.value).toBe('180 / 24');
    expect(visible.find((c) => c.key === 'processes')?.value).toBe('142');
    expect(visible.find((c) => c.key === 'disk_io')?.value).toContain('/s');

    const expired = statusMetricCharts(
      {
        ...node,
        online: false,
        fast: node.fast ? { ...node.fast, expires_at: '2026-11-25T11:00:00Z' } : null,
        full: node.full ? { ...node.full, stale: true } : null,
      },
      now,
    );
    expect(expired.find((c) => c.key === 'cpu')?.value).toBe('未知');
    expect(expired.find((c) => c.key === 'processes')?.value).toBe('未知');
  });

  it('管理连接离线时按采样有效期分别显示各方向带宽', () => {
    if (!node.fast) throw new Error('缺少快速采样');
    const offline = { ...node, online: false, fast: { ...node.fast, tx: null } };
    const bandwidth = (at: number) =>
      statusMetricCharts(offline, at).find((c) => c.key === 'network')?.value;
    expect(bandwidth(now)).toBe('10 Mbps / 未知');
    expect(bandwidth(Date.parse(offline.fast.expires_at))).toBe('未知 / 未知');
  });

  it('同一份快照的完整采样到期后转为未知', () => {
    if (!node.full) throw new Error('缺少完整采样');
    const expires = Date.parse(node.full.expires_at);
    const processes = (at: number) =>
      statusMetricCharts(node, at).find((c) => c.key === 'processes')?.value;
    expect(processes(expires - 1)).toBe('142');
    expect(processes(expires)).toBe('未知');
  });

  it('七天色块覆盖查询区间，保留边界内的首尾采样', () => {
    const start = '2026-11-18T12:01:02.500Z';
    const end = '2026-11-25T12:01:02.500Z';
    const line = {
      ...node.lines[0],
      history: [
        { at: start, ping: 20, loss: 0 },
        { at: '2026-11-25T12:01:02.499Z', ping: -1, loss: 100 },
      ],
    };
    const { blocks } = statusProbeHistoryBlocks(line, start, end, 3600);
    expect(blocks[0]).toMatchObject({
      start: Date.parse(start) / 1000,
      point: { ping: 20, loss: 0 },
    });
    expect(blocks.at(-1)).toMatchObject({
      end: Date.parse(end) / 1000,
      point: { ping: -1, loss: 100 },
    });
    expect(blocks.slice(1).every((block, i) => block.start === blocks[i].end)).toBe(true);
  });

  it('聚合 TCP 探测区间并保留全部失败状态', () => {
    const { blocks, summary } = statusProbeHistoryBlocks(
      {
        slot: 1,
        name: '线路 1',
        latest: { at: '2026-11-25T11:59:00Z', ping: -1, loss: 100 },
        history: [{ at: '2026-11-25T11:57:00Z', ping: -1, loss: 100 }],
      },
      '2026-11-25T11:00:00Z',
      '2026-11-25T12:00:00Z',
      60,
    );
    expect(blocks).toHaveLength(20);
    expect(summary).toEqual({ ping: -1, loss: 100 });
  });

  it('渲染重排后的四大核心模块与全部 8 个复用图表卡片', () => {
    const charts = statusMetricCharts(node, now);
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <DetailWorkspace
          node={node}
          rates={rates}
          snapshotAt="2026-11-25T12:00:00Z"
          now={now}
          range="7d"
          history={null}
        />
        <MetricTrendView
          title="资源历史趋势"
          headingLevel={2}
          range="1h"
          onRangeChange={() => {}}
          rangeOptions={[{ value: '1h', label: '1 小时' }]}
          charts={charts}
          trends={sampleTrends}
          statusText="测试窗口"
        />
      </MemoryRouter>,
    );
    expect(html).toContain('快照最近 1 小时');
    expect(html).toContain('公网 VPS');
    expect(html).toContain('日本Chiyoda');
    expect(html).toContain('Debian GNU/Linux 12');
    expect(html).toContain('4 核');
    expect(html).toContain('amd64');
    expect(html).toContain('完整字节');
    expect(html).toContain('当前租用周期进度');
    expect(html).toContain('电信直连');
    for (const label of [
      'CPU指标',
      '内存指标',
      '网络指标',
      '负载指标',
      '连接数指标',
      '文件系统容量指标',
      '磁盘 IO指标',
      '进程数指标',
    ]) {
      expect(html).toContain(label);
    }

    const unregisteredHtml = renderToStaticMarkup(
      <MemoryRouter>
        <DetailWorkspace
          node={{ ...node, price: null, expires: null, months: null, cpu_cores: undefined }}
          rates={rates}
          snapshotAt="2026-11-25T12:00:00Z"
          now={now}
          range="1h"
          history={null}
        />
      </MemoryRouter>,
    );
    expect(unregisteredHtml).toContain('未登记周期资费与到期时间');
    expect(unregisteredHtml).toContain('未设到期');
  });
});
