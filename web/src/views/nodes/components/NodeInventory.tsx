import { useState } from 'react';
import { Button } from '@/components/arc/button/button';
import DataTable, { type DataColumn } from '@/components/data-table';
import type { MockNode } from '../mock-data';

const states = {
  online: { label: '在线', tone: 'text-success' },
  offline: { label: '离线', tone: 'text-danger' },
  degraded: { label: '受限', tone: 'text-warning' },
};

function Usage({ value, label }: { value: number | null; label: string }) {
  if (value === null)
    return (
      <span className="text-text-secondary">
        <span className="min-[621px]:hidden">{label} </span>无数据
      </span>
    );
  return (
    <span className="inline-flex items-center gap-2 tabular-nums">
      <span className="min-[621px]:hidden">{label}</span>
      <svg width="48" height="4" aria-hidden="true" className="text-accent">
        <rect width="48" height="4" rx="2" fill="var(--surface-muted)" />
        <rect width={(48 * value) / 100} height="4" rx="2" fill="currentColor" />
      </svg>
      {value}%
    </span>
  );
}

export default function NodeInventory({ nodes }: { nodes: MockNode[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const selected = nodes.find((node) => node.id === expanded);
  const columns: DataColumn<MockNode>[] = [
    {
      key: 'id',
      label: '节点',
      render: (_, node) => (
        <Button
          variant="ghost"
          aria-expanded={expanded === node.id}
          aria-controls="node-details"
          onClick={() => setExpanded(expanded === node.id ? null : node.id)}
        >
          {node.id}
          <span className="sr-only">，查看节点详情</span>
        </Button>
      ),
    },
    { key: 'region', label: '地区' },
    { key: 'type', label: '类型' },
    {
      key: 'status',
      label: '状态',
      render: (_, node) => (
        <span className={`inline-flex items-center gap-2 ${states[node.status].tone}`}>
          <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
          {states[node.status].label}
        </span>
      ),
    },
    { key: 'engine', label: '引擎' },
    {
      key: 'cpu',
      label: 'CPU',
      numeric: true,
      render: (_, node) => <Usage value={node.cpu} label="CPU" />,
    },
    {
      key: 'mem',
      label: '内存',
      numeric: true,
      render: (_, node) => <Usage value={node.mem} label="内存" />,
    },
    {
      key: 'today',
      label: '今日流量',
      numeric: true,
      render: (_, node) =>
        node.status === 'offline' ? (
          <span className="text-text-secondary">无数据</span>
        ) : (
          node.traffic
        ),
    },
    {
      key: 'observed',
      label: '实际修订',
      numeric: true,
      render: (_, node) => (
        <span className="inline-flex flex-wrap items-center gap-2 tabular-nums">
          r{node.observed}
          {node.desired !== node.observed && (
            <span className="text-(length:--text-xs) text-warning">待发布</span>
          )}
        </span>
      ),
    },
  ];
  return (
    <>
      <DataTable
        rows={nodes}
        columns={columns}
        rowKey="id"
        tableClassName="sm:min-w-[1120px]"
        caption="节点资产与连接状态（演示数据）"
        emptyMessage="没有符合条件的节点，请清除筛选后重试"
      />
      <div id="node-details">
        {selected && (
          <section
            aria-labelledby="node-detail-heading"
            className="mt-6 border-t-[0.5px] border-border pt-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="node-detail-heading" className="font-medium">
                {selected.id} 节点信息
              </h2>
              <span className="text-(length:--text-xs) text-text-secondary">演示快照</span>
            </div>
            <p className={`mt-3 ${states[selected.status].tone}`}>
              {selected.status === 'offline'
                ? '节点离线，暂无最新指标。已有代理服务的实际运行状态待确认。'
                : selected.status === 'degraded'
                  ? '节点仍在线，但运行受限，请检查引擎与端口可用性。'
                  : 'Agent 在线，已连接面板。'}
            </p>
            <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ['系统', `${selected.os} / ${selected.arch}`],
                ['Agent 版本', selected.agent],
                ['公网地址', selected.pub],
                ['内网地址', selected.nat ? selected.priv : '不适用'],
                ['最后心跳（快照）', selected.heartbeat],
                ['期望 / 实际修订', `r${selected.desired} / r${selected.observed}`],
                ['接入日期', selected.since],
                ['地址归属', selected.shared ? '服务商共享公网地址' : '独立公网地址'],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-(length:--text-xs) text-text-secondary">{label}</dt>
                  <dd className="mt-1 break-words tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            {selected.nat && (
              <p className="mt-4 text-text-secondary">
                公网 NAT 映射由服务商分配；此处仅展示地址，不代表端口已授权或可达。
              </p>
            )}
          </section>
        )}
      </div>
    </>
  );
}
