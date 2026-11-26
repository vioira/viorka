import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { MetricTrends } from '@/api/metric-trends';
import { nodeTime } from '@/api/nodes';
import type { StatusNode, StatusPage } from '@/api/public-status';
import { ToastStackProvider } from '@/components/arc/toast-stack/toast-stack';
import { MetricTrendView } from '@/views/nodes/components/NodeMetricHistory';
import DetailWorkspace from './components/DetailWorkspace';
import LiveTelemetryStrip from './components/LiveTelemetryStrip';
import NodeStatusDetail from './components/NodeStatusDetail';
import { PublicNodeSwitcherMenu } from './components/PublicNodeSwitcher';
import PublicTCPProbes from './components/PublicTCPProbes';
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

  it('默认展示实时采样和全部系统曲线，历史链接保留所选范围', () => {
    const render = (streamState: 'connected' | 'disabled', search = '') =>
      renderToStaticMarkup(
        <MemoryRouter initialEntries={[`/status/n1${search}`]}>
          <ToastStackProvider>
            <NodeStatusDetail
              node={{ ...node, metric_trends: sampleTrends }}
              rates={rates}
              snapshotAt={new Date(now).toISOString()}
              now={now}
              streamState={streamState}
            />
          </ToastStackProvider>
        </MemoryRouter>,
      );
    const html = render('connected');
    for (const label of ['CPU', '负载', '连接数', '进程数']) {
      expect(html).toContain(`${label}实时采样`);
    }
    expect(render('connected', '?range=7d')).toContain('刷新历史');
    expect(html).toContain('网络实时采样');
    expect(html).toContain('24.5%');
    expect(html).toContain('暂停显示');
    expect(html).toContain('最近 10 分钟');
    expect(html).not.toContain('刷新历史');
    expect(render('disabled')).toContain('实时推送已关闭');
  });

  it('公开详情的末格只到最近已结束的边界，顶部延迟仍显示更新的探测', () => {
    const snapshotAt = '2026-11-25T17:06:30+08:00';
    const latest = { at: snapshotAt, ping: 28, loss: 0 };
    const line = { ...node.lines[0], latest, history: [] };
    const render = (historical: boolean) =>
      renderToStaticMarkup(
        <PublicTCPProbes
          node={{ ...node, lines: [line] }}
          snapshotAt={snapshotAt}
          range={historical ? '1h' : 'live'}
          history={
            historical
              ? {
                  start: '2026-11-25T16:06:30+08:00',
                  end: snapshotAt,
                  probe_period: 60,
                  lines: [
                    { ...line, latest: { ...latest, at: '2026-11-25T17:05:00+08:00', ping: 42 } },
                  ],
                  charts: {},
                }
              : null
          }
        />,
      );
    const lastInterval = `${nodeTime('2026-11-25T17:03:00+08:00')} 至 ${nodeTime('2026-11-25T17:06:00+08:00')}`;
    for (const historical of [false, true]) {
      const html = render(historical);
      expect(html).toContain(lastInterval);
      expect(html).toContain('>28.0<');
    }
  });

  it('七天色块保留查询起点的采样，隐藏尚未结束的末格', () => {
    const start = '2026-11-18T12:01:02.500Z';
    const end = '2026-11-25T12:01:02.500Z';
    const line = {
      ...node.lines[0],
      history: [
        { at: start, ping: 20, loss: 0 },
        { at: '2026-11-25T12:01:02.499Z', ping: -1, loss: 100 },
      ],
    };
    const { blocks, width } = statusProbeHistoryBlocks(line, start, end, 3600);
    expect(blocks[0]).toMatchObject({
      start: Date.parse(start) / 1000,
      point: { ping: 20, loss: 0 },
    });
    expect(blocks.at(-1)).toMatchObject({
      end: Math.floor(Date.parse(end) / 1000 / width) * width,
      point: undefined,
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

  it('渲染重排后的实时体征条、详情工作区、TCP 线路质量与分层趋势布局', () => {
    const charts = statusMetricCharts(node, now);
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ToastStackProvider>
          <PublicNodeSwitcherMenu
            current={node}
            directory={[node, { ...node, id: 'n2', alias: 'HK Edge' }]}
            onOpen={() => {}}
          />
          <LiveTelemetryStrip node={node} now={now} cpuPoints={sampleTrends.cpu.points} />
          <DetailWorkspace node={node} rates={rates} now={now} />
          <PublicTCPProbes
            node={node}
            snapshotAt="2026-11-25T12:00:00Z"
            range="7d"
            history={null}
          />
          <NodeStatusDetail
            streamState="connected"
            node={node}
            rates={rates}
            snapshotAt="2026-11-25T12:00:00Z"
            now={now}
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
        </ToastStackProvider>
      </MemoryRouter>,
    );
    expect(html).toContain('CPU 与负载');
    expect(html).toContain('内存与 Swap');
    expect(html).toContain('实时网络速率');
    expect(html).toContain('存储与磁盘 IO');
    expect(html).toContain('4 核');
    expect(html).toContain('TCP 180 / UDP 24');
    expect(html).toContain('快照最近 1 小时');
    expect(html).toContain('完整字节');
    expect(html).toContain('当前租用周期进度');
    expect(html).toContain('运行环境');
    expect(html).toContain('电信直连');
    expect(html).toContain('数据观测');
    expect(html).not.toContain('展开另外 3 项指标');
    expect(html).not.toContain('收起次级曲线');
    expect(html).toContain('上一节点：HK Edge');
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

    const expiredLiveHtml = renderToStaticMarkup(
      <LiveTelemetryStrip
        node={{
          ...node,
          online: false,
          fast: node.fast ? { ...node.fast, expires_at: '2026-11-25T11:00:00Z' } : null,
          full: node.full ? { ...node.full, stale: true } : null,
        }}
        now={now}
      />,
    );
    expect(expiredLiveHtml).toContain('CPU 采样已过期');
    expect(expiredLiveHtml).toContain('内存采样已过期');
    expect(expiredLiveHtml).toContain('磁盘采样已过期');

    const unregisteredHtml = renderToStaticMarkup(
      <MemoryRouter>
        <DetailWorkspace
          node={{ ...node, price: null, expires: null, months: null, cpu_cores: undefined }}
          rates={rates}
          now={now}
        />
      </MemoryRouter>,
    );
    expect(unregisteredHtml).toContain('未登记周期资费与到期时间');
    expect(unregisteredHtml).toContain('未设到期');
  });
});
