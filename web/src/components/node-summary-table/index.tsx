import { ArrowDown, ArrowUp } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/arc/button/button';
import { Tooltip } from '@/components/arc/tooltip/tooltip';
import DataTable, { type DataColumn } from '@/components/data-table';
import type { EmptyStatesProps } from '@/components/empty-states';
import NodeStatus from '@/components/node-status';
import Usage from '@/components/usage';
import { usageColor } from '@/utils/usage-tone';

function TrafficPercent({ value }: { value: number }) {
  return (
    <span style={{ color: usageColor(value) }}>
      <span className="sr-only">今日计费流量占配额 </span>
      {value}%
    </span>
  );
}

export type SummaryNode = {
  id: string;
  name?: string;
  href?: string;
  region: string;
  kind: string;
  state: string;
  uptime: string;
  cost: string;
  expiry: string;
  expiryDate: string;
  statusContent?: ReactNode;
  migrationLabel?: string;
  engines?: string[];
  last_seen_at?: string;
  cpu: number | null;
  memory: number | null;
  traffic: number | null;
  trafficUnlimited?: boolean;
  trafficQuotaPercent?: number | null;
  trafficUploadLabel?: string;
  trafficDownloadLabel?: string;
};

const columns: DataColumn<SummaryNode>[] = [
  {
    key: 'id',
    label: '节点',
    width: 144,
    render: (_, node) =>
      node.href ? (
        <Link to={node.href} className="font-medium text-success hover:underline wrap-anywhere">
          {node.name || node.id}
        </Link>
      ) : (
        <span className="font-medium text-success">{node.name || node.id}</span>
      ),
  },
  {
    key: 'region',
    label: '地区 / 类型',
    width: 168,
    render: (_, node) => (
      <div className="flex flex-wrap items-center">
        <span className="min-w-0 break-words font-medium">{node.region}</span>
        <span className="mx-1">/</span>
        <span className="text-(length:--text-xs) text-text-secondary">{node.kind}</span>
      </div>
    ),
  },
  {
    key: 'state',
    label: '状态',
    width: 172,
    render: (_, node) => {
      const status = node.statusContent ?? (
        <NodeStatus state={node.state} lastSeenAt={node.last_seen_at} />
      );
      return (
        <div className="grid gap-1">
          {status}
          <span className="text-(length:--text-xs) text-text-secondary tabular-nums">
            运行时长 {node.uptime}
          </span>
          {node.migrationLabel && (
            <span className="text-(length:--text-xs) text-text-secondary">
              {node.migrationLabel}
            </span>
          )}
        </div>
      );
    },
  },
  {
    key: 'cost',
    label: '费用',
    width: 104,
    render: (_, node) => <span className="whitespace-nowrap tabular-nums">{node.cost}</span>,
  },
  {
    key: 'expiry',
    label: '到期时间',
    width: 152,
    render: (_, node) => (
      <span className="whitespace-nowrap tabular-nums">
        <span className="sm:hidden" aria-hidden="true">
          {node.expiryDate}
        </span>
        <span className="sr-only sm:not-sr-only">{node.expiry}</span>
      </span>
    ),
  },
  {
    key: 'engines',
    label: '引擎',
    width: 176,
    render: (_, node) => (
      <div>
        <div className="flex flex-wrap items-baseline gap-2">
          <span>{node.engines?.[0] ?? (node.engines ? '未检测到引擎' : '尚未读取')}</span>
          {node.engines && node.engines.length > 1 && (
            <Tooltip
              content={
                <ul>
                  {node.engines.slice(1).map((engine) => (
                    <li key={engine} className="wrap-anywhere">
                      {engine}
                    </li>
                  ))}
                </ul>
              }
            >
              <Link
                to="#"
                onClick={(event) => event.preventDefault()}
                aria-label={`查看其余 ${node.engines.length - 1} 个引擎`}
                className="text-success cursor-pointer underline-offset-4 tabular-nums hover:opacity-90"
              >
                +{node.engines.length - 1}
              </Link>
            </Tooltip>
          )}
        </div>
        {node.engines && node.engines.length > 1 && (
          <span className="hidden text-(length:--text-xs) text-text-secondary [@media(hover:none)]:block">
            {node.engines.slice(1).join('、')}
          </span>
        )}
      </div>
    ),
  },
  {
    key: 'cpu',
    label: 'CPU',
    width: 120,
    numeric: true,
    render: (_, node) => <Usage value={node.cpu} label="CPU" />,
  },
  {
    key: 'memory',
    label: '内存',
    width: 120,
    numeric: true,
    render: (_, node) => <Usage value={node.memory} label="内存" />,
  },
  {
    key: 'traffic',
    label: '今日流量',
    width: 200,
    numeric: true,
    render: (_, node) => (
      <div className="inline-flex items-center gap-3 whitespace-nowrap tabular-nums">
        {node.traffic === null ? (
          <span className="text-text-secondary">无数据</span>
        ) : (
          <div className="grid justify-items-start gap-1">
            <span className="inline-flex items-center gap-1">
              <ArrowUp className="size-3.5 shrink-0 text-(--traffic-upload)" aria-hidden="true" />
              <span className="sr-only">上行</span>
              <span>{node.trafficUploadLabel}</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <ArrowDown
                className="size-3.5 shrink-0 text-(--traffic-download)"
                aria-hidden="true"
              />
              <span className="sr-only">下行</span>
              <span>{node.trafficDownloadLabel}</span>
            </span>
          </div>
        )}
        {node.trafficUnlimited ? (
          <Tooltip content="无限流量" openOnClick>
            <div>
              <TrafficPercent value={0} />
            </div>
          </Tooltip>
        ) : (
          node.trafficQuotaPercent != null && <TrafficPercent value={node.trafficQuotaPercent} />
        )}
      </div>
    ),
  },
];

export default function NodeSummaryTable({
  nodes,
  showAll = false,
  framed = true,
  loading = false,
  loaded = true,
  emptyState,
  caption = '节点资源与运行状态',
  emptyMessage = '暂无节点，请先注册 Agent',
}: {
  nodes: SummaryNode[];
  showAll?: boolean;
  framed?: boolean;
  loading?: boolean;
  loaded?: boolean;
  emptyState?: Omit<EmptyStatesProps, 'title'>;
  caption?: string;
  emptyMessage?: string;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const visibleNodes = showAll || expanded ? nodes : nodes.slice(0, 5);
  return (
    <section
      aria-labelledby={framed ? `${id}-heading` : undefined}
      aria-label={framed ? undefined : caption}
      className="v-card"
    >
      {framed && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={`${id}-heading`} className="v-card-title">
            节点
          </h2>
          {!showAll && nodes.length > 0 && (
            <Button
              variant="ghost"
              onClick={() => setExpanded(!expanded)}
              aria-expanded={expanded}
              aria-controls={id}
            >
              {expanded ? '收起节点' : `查看全部 ${nodes.length} 个`}
            </Button>
          )}
        </div>
      )}
      <div id={id}>
        <DataTable
          stickyFirstColumn
          minWidth={1356}
          rows={visibleNodes}
          columns={columns}
          rowKey="id"
          caption={caption}
          loaded={loaded}
          loading={loading}
          emptyMessage={emptyMessage}
          emptyState={emptyState}
          unknownMessage="节点尚未读取"
        />
      </div>
      {!showAll && nodes.length > 0 && (
        <p className="mt-3 text-(length:--text-xs) text-text-secondary">
          显示 {expanded ? nodes.length : Math.min(nodes.length, 5)} / {nodes.length} 个节点
        </p>
      )}
    </section>
  );
}
