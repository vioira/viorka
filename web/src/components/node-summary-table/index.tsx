import { type ReactNode, useId, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/arc/button/button';
import { Tooltip } from '@/components/arc/tooltip/tooltip';
import DataTable, { type DataColumn } from '@/components/data-table';
import NodeStatus from '@/components/node-status';
import Usage from '@/components/usage';
export type SummaryNode = {
  id: string;
  name?: string;
  href?: string;
  region: string;
  kind: string;
  state: string;
  statusContent?: ReactNode;
  engines?: string[];
  last_seen_at?: string;
  cpu: number | null;
  memory: number | null;
  traffic: number | null;
};

const columns: DataColumn<SummaryNode>[] = [
  {
    key: 'id',
    label: '节点',
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
    render: (_, node) => {
      if (node.statusContent) return node.statusContent;
      return <NodeStatus state={node.state} lastSeenAt={node.last_seen_at} />;
    },
  },
  {
    key: 'engines',
    label: '引擎',
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
    width: 184,
    numeric: true,
    render: (_, node) => <Usage value={node.cpu} label="CPU" />,
  },
  {
    key: 'memory',
    label: '内存',
    width: 184,
    numeric: true,
    render: (_, node) => <Usage value={node.memory} label="内存" />,
  },
  {
    key: 'traffic',
    label: '今日流量',
    numeric: true,
    render: (_, node) =>
      node.traffic === null ? (
        <span className="text-text-secondary">无数据</span>
      ) : (
        `${node.traffic.toFixed(1)} GB`
      ),
  },
];

export default function NodeSummaryTable({
  nodes,
  showAll = false,
  framed = true,
  loading = false,
  caption = '节点资源与运行状态',
  emptyMessage = '暂无节点，请先注册 Agent',
}: {
  nodes: SummaryNode[];
  showAll?: boolean;
  framed?: boolean;
  loading?: boolean;
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
      aria-busy={loading}
      className="v-card"
    >
      {framed && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={`${id}-heading`} className="v-card-title">
            节点
          </h2>
          {!showAll && (
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
        <div className="hidden md:block">
          <DataTable
            tableClassName="min-w-[1040px]"
            rows={visibleNodes}
            columns={columns}
            rowKey="id"
            caption={caption}
            emptyMessage={emptyMessage}
          />
        </div>
        <div className="md:hidden">
          {visibleNodes.length === 0 ? (
            <p className="py-6 text-text-secondary">{emptyMessage}</p>
          ) : (
            <ul aria-label={caption} className="grid gap-4">
              {visibleNodes.map((node) => (
                <li
                  key={node.id}
                  className="min-w-0 rounded-(--table-row-radius) border-[1px] border-border bg-(--surface) p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    {node.href ? (
                      <Link
                        to={node.href}
                        className="flex min-w-0 items-center font-medium text-accent hover:underline wrap-anywhere"
                      >
                        {node.name || node.id}
                      </Link>
                    ) : (
                      <span className="min-w-0 font-medium wrap-anywhere">
                        {node.name || node.id}
                      </span>
                    )}
                    {columns[2].render?.(node.state, node)}
                  </div>
                  <p className="mt-2 text-text-secondary wrap-anywhere">
                    {node.region} / {node.kind}
                  </p>
                  <dl className="mt-4 grid gap-4 text-(length:--text-sm)">
                    <div className="grid grid-cols-[4rem_minmax(0,1fr)] gap-3">
                      <dt className="text-text-secondary">引擎</dt>
                      <dd className="min-w-0 wrap-anywhere">
                        {node.engines?.length ? (
                          <ul className="space-y-1">
                            {node.engines.map((engine) => (
                              <li key={engine}>{engine}</li>
                            ))}
                          </ul>
                        ) : node.engines ? (
                          '未检测到引擎'
                        ) : (
                          '尚未读取'
                        )}
                      </dd>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <dt className="text-text-secondary">CPU</dt>
                      <dd>
                        <Usage value={node.cpu} />
                      </dd>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <dt className="text-text-secondary">内存</dt>
                      <dd>
                        <Usage value={node.memory} />
                      </dd>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <dt className="text-text-secondary">今日流量</dt>
                      <dd className="tabular-nums">{columns[6].render?.(node.traffic, node)}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {!showAll && (
        <p className="mt-3 text-(length:--text-xs) text-text-secondary">
          显示 {expanded ? nodes.length : Math.min(nodes.length, 5)} / {nodes.length}{' '}
          个节点，桌面表格排序作用于当前显示的记录。
        </p>
      )}
    </section>
  );
}
