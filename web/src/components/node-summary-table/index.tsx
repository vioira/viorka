import { ArrowDown, ArrowUp, Folder, Globe } from 'lucide-react';
import { type ReactNode, useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { Category } from '@/api/public-status';
import { Button } from '@/components/arc/button/button';
import { Tooltip } from '@/components/arc/tooltip/tooltip';
import { CountryFlag } from '@/components/country-flag';
import DataTable, { type DataColumn } from '@/components/data-table';
import type { EmptyStatesProps } from '@/components/empty-states';
import { NodeOSLabel } from '@/components/node-os-icon';
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
  group?: Category | null;
  tags?: Category[];
  href?: string;
  region: string;
  countryCode?: string;
  os: string;
  kind: string;
  state: string;
  uptime: string;
  uptimeSampleHint?: string;
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

function CategoryPill({
  category,
  isGroup,
  onClick,
}: {
  category: Category;
  isGroup?: boolean;
  onClick?: () => void;
}) {
  const sharedMark = category.shared ? (
    <Globe size={12} className="shrink-0 text-success" aria-hidden="true" />
  ) : null;
  const baseClass = isGroup
    ? 'inline-flex max-w-36 items-center gap-1.5 rounded-lg border-[1px] border-border bg-surface-raised px-2 py-0.5 text-(length:--text-xs) font-medium text-foreground'
    : 'inline-flex max-w-28 items-center gap-1 rounded-full border-[1px] border-border-subtle bg-surface-muted px-2 py-0.5 text-(length:--text-xs) text-text-secondary';

  if (onClick) {
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
        title={`按${isGroup ? '分组' : '标签'}“${category.name}”筛选${category.shared ? '（公开展示）' : ''}`}
        className={`${baseClass} hover:border-border-strong hover:text-foreground`}
      >
        {isGroup && <Folder size={12} className="shrink-0 text-text-muted" aria-hidden="true" />}
        <span className="truncate">{category.name}</span>
        {sharedMark}
      </button>
    );
  }

  return (
    <span
      title={category.shared ? `${category.name}（公开展示）` : category.name}
      className={baseClass}
    >
      {isGroup && <Folder size={12} className="shrink-0 text-text-muted" aria-hidden="true" />}
      <span className="truncate">{category.name}</span>
      {sharedMark}
    </span>
  );
}

function buildColumns({
  onFilterByGroup,
  onFilterByTag,
  renderCategoryEditor,
}: {
  onFilterByGroup?: (groupId: string) => void;
  onFilterByTag?: (tagId: string) => void;
  renderCategoryEditor?: (node: SummaryNode) => ReactNode;
}): DataColumn<SummaryNode>[] {
  return [
    {
      key: 'id',
      label: '节点',
      width: 152,
      render: (_, node) => (
        <div className="grid min-w-0 gap-1">
          {node.href ? (
            <Link to={node.href} className="font-medium text-success hover:underline wrap-anywhere">
              {node.name || node.id}
            </Link>
          ) : (
            <span className="font-medium text-success">{node.name || node.id}</span>
          )}
          <div className="text-(length:--text-xs) text-text-secondary">
            <NodeOSLabel os={node.os} compact />
          </div>
        </div>
      ),
    },
    {
      key: 'categories',
      label: '分组与标签',
      sortable: false,
      width: 236,
      render: (_, node) => {
        const group = node.group;
        const tags = node.tags ?? [];
        const shownTags = tags.slice(0, 2);
        const extraTags = tags.slice(2);
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            {group ? (
              <CategoryPill
                category={group}
                isGroup
                onClick={onFilterByGroup ? () => onFilterByGroup(group.id) : undefined}
              />
            ) : (
              <span className="text-(length:--text-xs) text-text-muted">未分组</span>
            )}
            {shownTags.map((tag) => (
              <CategoryPill
                key={tag.id}
                category={tag}
                onClick={onFilterByTag ? () => onFilterByTag(tag.id) : undefined}
              />
            ))}
            {extraTags.length > 0 && (
              <Tooltip
                openOnClick
                content={
                  <ul>
                    {extraTags.map((tag) => (
                      <li key={tag.id} className="wrap-anywhere">
                        {tag.name}
                        {tag.shared ? '（公开）' : ''}
                      </li>
                    ))}
                  </ul>
                }
              >
                <button
                  type="button"
                  onClick={(event) => event.stopPropagation()}
                  aria-label={`其余 ${extraTags.length} 个标签：${extraTags.map((t) => t.name).join('、')}`}
                  className="rounded-full border-[1px] border-border-subtle bg-surface-muted px-2 py-0.5 text-(length:--text-xs) text-text-secondary tabular-nums hover:border-border-strong hover:text-foreground"
                >
                  +{extraTags.length}
                </button>
              </Tooltip>
            )}
            {renderCategoryEditor?.(node)}
          </div>
        );
      },
    },
    {
      key: 'region',
      label: '地区与类型',
      width: 156,
      render: (_, node) => (
        <div className="grid min-w-0 gap-1">
          <span className="inline-flex min-w-0 items-center gap-1.5 font-medium">
            <CountryFlag code={node.countryCode} />
            <span className="min-w-0 break-words">{node.region}</span>
          </span>
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
            <div className="text-(length:--text-xs) text-text-secondary tabular-nums">
              {node.uptimeSampleHint ? (
                <Tooltip content={node.uptimeSampleHint} openOnClick>
                  <button
                    type="button"
                    className="cursor-help text-left underline decoration-dotted underline-offset-4"
                    onClick={(event) => event.stopPropagation()}
                  >
                    运行时长 {node.uptime}
                  </button>
                </Tooltip>
              ) : (
                <>运行时长 {node.uptime}</>
              )}
            </div>
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
      width: 152,
      render: (_, node) => (
        <div className="grid gap-1">
          <div className="whitespace-nowrap tabular-nums">{node.cost}</div>
          <div className="whitespace-nowrap tabular-nums text-(length:--text-xs) text-text-secondary">
            <span className="sm:hidden" aria-hidden="true">
              {node.expiryDate}
            </span>
            <span className="sr-only sm:not-sr-only">{node.expiry}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'engines',
      label: '引擎',
      width: 168,
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
      width: 112,
      render: (_, node) => <Usage value={node.cpu} label="CPU" />,
    },
    {
      key: 'memory',
      label: '内存',
      width: 112,
      render: (_, node) => <Usage value={node.memory} label="内存" />,
    },
    {
      key: 'traffic',
      label: '今日流量',
      width: 192,
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
              <button
                type="button"
                onClick={(event) => event.stopPropagation()}
                className="cursor-help border-0 bg-transparent p-0"
              >
                <TrafficPercent value={0} />
              </button>
            </Tooltip>
          ) : (
            node.trafficQuotaPercent != null && <TrafficPercent value={node.trafficQuotaPercent} />
          )}
        </div>
      ),
    },
  ];
}

export default function NodeSummaryTable({
  nodes,
  showAll = false,
  framed = true,
  plain = false,
  loading = false,
  loaded = true,
  emptyState,
  caption = '节点资源与运行状态',
  emptyMessage = '暂无节点，请先注册 Agent',
  selectable = false,
  selectedKeys,
  onSelectionChange,
  onRowClick,
  onFilterByGroup,
  onFilterByTag,
  renderCategoryEditor,
}: {
  nodes: SummaryNode[];
  showAll?: boolean;
  framed?: boolean;
  plain?: boolean;
  loading?: boolean;
  loaded?: boolean;
  emptyState?: Omit<EmptyStatesProps, 'title'>;
  caption?: string;
  emptyMessage?: string;
  selectable?: boolean;
  selectedKeys?: string[];
  onSelectionChange?: (keys: string[]) => void;
  onRowClick?: (node: SummaryNode) => void;
  onFilterByGroup?: (groupId: string) => void;
  onFilterByTag?: (tagId: string) => void;
  renderCategoryEditor?: (node: SummaryNode) => ReactNode;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const visibleNodes = showAll || expanded ? nodes : nodes.slice(0, 5);
  const columns = useMemo(
    () => buildColumns({ onFilterByGroup, onFilterByTag, renderCategoryEditor }),
    [onFilterByGroup, onFilterByTag, renderCategoryEditor],
  );

  const tableNode = (
    <div id={id}>
      <DataTable
        stickyFirstColumn
        minWidth={1520}
        rows={visibleNodes}
        columns={columns}
        rowKey="id"
        caption={caption}
        loaded={loaded}
        loading={loading}
        emptyMessage={emptyMessage}
        emptyState={emptyState}
        unknownMessage="节点尚未读取"
        selectable={selectable}
        selectedKeys={selectedKeys}
        onSelectionChange={onSelectionChange}
        onRowClick={onRowClick}
        itemName={{ one: '台节点', other: '台节点' }}
      />
    </div>
  );

  if (plain) return tableNode;

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
      {tableNode}
      {!showAll && nodes.length > 0 && (
        <p className="mt-3 text-(length:--text-xs) text-text-secondary">
          显示 {expanded ? nodes.length : Math.min(nodes.length, 5)} / {nodes.length} 个节点
        </p>
      )}
    </section>
  );
}
