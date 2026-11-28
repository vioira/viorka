import { AlertTriangle, ArrowDown, ArrowUp, Check, Folder, Globe } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { Link } from 'react-router';
import { nodeTime } from '@/api/nodes';
import type { Category } from '@/api/public-status';
import { Badge, type BadgeTone } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { Tooltip } from '@/components/arc/tooltip/tooltip';
import { CardGridSkeleton, shouldHandleCardClick } from '@/components/card-kit';
import { CountryFlag } from '@/components/country-flag';
import EmptyStates, { type EmptyStatesProps } from '@/components/empty-states';
import { NodeOSLabel } from '@/components/node-os-icon';
import { UsageBar } from '@/components/usage/UsageBar';
import { usageColor } from '@/utils/usage-tone';

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
  expiryTone?: 'normal' | 'warning' | 'danger';
  statusContent?: ReactNode;
  installAction?: ReactNode;
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

const NODE_STATUS_META: Record<string, { label: string; tone: BadgeTone }> = {
  online: { label: '在线', tone: 'success' },
  offline: { label: '离线', tone: 'danger' },
  pending: { label: '待注册', tone: 'warning' },
  disabled: { label: '已禁用', tone: 'neutral' },
  degraded: { label: '受限', tone: 'warning' },
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
    ? 'inline-flex max-w-36 items-center gap-1.5 rounded-lg border-[1px] border-border bg-background px-2 py-0.5 text-(length:--text-xs) font-medium text-foreground'
    : 'inline-flex max-w-28 items-center gap-1 rounded-full border-[1px] border-border-subtle bg-surface-muted px-2 py-0.5 text-(length:--text-xs) text-text-secondary';

  if (onClick) {
    return (
      <button
        type="button"
        data-card-interactive="1"
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

function NodeCard({
  node,
  selectable,
  batchActive,
  selected,
  onToggleSelect,
  onRowClick,
  onFilterByGroup,
  onFilterByTag,
  renderCategoryEditor,
}: {
  node: SummaryNode;
  selectable: boolean;
  batchActive: boolean;
  selected: boolean;
  onToggleSelect?: (id: string) => void;
  onRowClick?: (node: SummaryNode) => void;
  onFilterByGroup?: (groupId: string) => void;
  onFilterByTag?: (tagId: string) => void;
  renderCategoryEditor?: (node: SummaryNode) => ReactNode;
}) {
  const statusInfo = NODE_STATUS_META[node.state] ?? { label: '未知', tone: 'neutral' as const };
  const displayName = node.name || node.id;
  const tags = node.tags ?? [];
  const shownTags = tags.slice(0, 2);
  const extraTags = tags.slice(2);
  const interactive = Boolean(onRowClick) || (selectable && batchActive);
  const cpuVal =
    node.cpu !== null && Number.isFinite(node.cpu) && node.cpu >= 0 ? node.cpu : undefined;
  const memVal =
    node.memory !== null && Number.isFinite(node.memory) && node.memory >= 0
      ? node.memory
      : undefined;
  const group = node.group ?? null;
  const engineSummary = node.engines?.length
    ? node.engines.join('，')
    : node.engines
      ? '未检测到引擎'
      : '尚未读取';
  const lastSeenSummary =
    node.state === 'online'
      ? `运行 ${node.uptime}`
      : node.state === 'pending'
        ? '未连接'
        : node.last_seen_at
          ? `最后在线 ${nodeTime(node.last_seen_at)}`
          : node.uptime;

  const statusBadge = (
    <Badge size="sm" dot pill tone={statusInfo.tone}>
      {statusInfo.label}
    </Badge>
  );

  return (
    <article
      data-card="node"
      data-selected={selected ? 'true' : undefined}
      data-clickable={interactive ? 'true' : undefined}
      onClick={(event) => {
        if (!interactive || !shouldHandleCardClick(event)) return;
        if (selectable && batchActive) {
          onToggleSelect?.(node.id);
        } else {
          onRowClick?.(node);
        }
      }}
      className={`group relative flex min-w-0 flex-col justify-between rounded-(--radius-surface) border-[1px] p-4 transition-colors ${
        interactive ? 'cursor-pointer' : ''
      } ${
        selected
          ? 'border-(--table-row-selected-border) bg-(--table-row-selected)'
          : 'border-border bg-surface hover:border-border-strong hover:bg-surface-muted/30'
      }`}
    >
      <div className="space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <CountryFlag code={node.countryCode} />
              {node.href ? (
                <Link
                  to={node.href}
                  data-card-interactive="1"
                  onClick={(event) => {
                    if (selectable && batchActive) {
                      event.preventDefault();
                      onToggleSelect?.(node.id);
                    }
                  }}
                  className="truncate text-(length:--text-sm) font-medium text-foreground hover:text-accent hover:underline"
                >
                  {displayName}
                </Link>
              ) : (
                <span className="truncate text-(length:--text-sm) font-medium text-foreground">
                  {displayName}
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-(length:--text-xs) text-text-secondary">
              <span className="min-w-0 break-words">{node.region}</span>
              <span>{node.kind}</span>
              <NodeOSLabel os={node.os} compact />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {node.state === 'offline' && node.last_seen_at ? (
              <Tooltip
                content={
                  <span className="tabular-nums">最后在线：{nodeTime(node.last_seen_at)}</span>
                }
              >
                <span className="inline-flex">{statusBadge}</span>
              </Tooltip>
            ) : (
              statusBadge
            )}
            {selectable && (
              <button
                type="button"
                role="checkbox"
                aria-checked={selected}
                aria-label={`选择节点 ${displayName}`}
                data-card-interactive="1"
                data-select-cell=""
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleSelect?.(node.id);
                }}
                className={`inline-flex size-5 items-center justify-center rounded-md border-[1px] transition-opacity ${
                  selected
                    ? 'border-accent bg-accent text-accent-foreground opacity-100'
                    : batchActive
                      ? 'border-border-strong bg-background opacity-100'
                      : 'border-border-strong bg-background opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                }`}
              >
                {selected && <Check size={13} strokeWidth={2.25} aria-hidden="true" />}
              </button>
            )}
          </div>
        </div>

        {/* Migration warning */}
        {node.migrationLabel && (
          <div className="flex items-center gap-1.5 rounded-(--radius-control) bg-(--warning-muted) px-2.5 py-1.5 text-(length:--text-xs) text-(--status-warning-text)">
            <AlertTriangle size={14} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
            <span className="wrap-anywhere">{node.migrationLabel}</span>
          </div>
        )}

        {/* Primary Telemetry Zone */}
        {node.state === 'pending' ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-(--radius-control) border-[1px] border-border-subtle bg-surface-muted/50 p-3">
            <span className="text-(length:--text-xs) text-text-secondary">等待 Agent 注册接入</span>
            {node.installAction}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2.5 rounded-(--radius-control) border-[1px] border-border-subtle bg-surface-muted/50 p-3">
            <div className="min-w-0 space-y-1.5">
              <div className="flex items-center justify-between gap-1 text-(length:--text-xs)">
                <span className="text-text-secondary">CPU</span>
                <span className="font-medium text-foreground tabular-nums">
                  {cpuVal !== undefined ? `${Number(cpuVal.toFixed(1))}%` : '无数据'}
                </span>
              </div>
              <UsageBar value={cpuVal} />
            </div>

            <div className="min-w-0 space-y-1.5">
              <div className="flex items-center justify-between gap-1 text-(length:--text-xs)">
                <span className="text-text-secondary">内存</span>
                <span className="font-medium text-foreground tabular-nums">
                  {memVal !== undefined ? `${Number(memVal.toFixed(1))}%` : '无数据'}
                </span>
              </div>
              <UsageBar value={memVal} />
            </div>

            <div className="min-w-0 space-y-1">
              <div className="flex items-center justify-between gap-1 text-(length:--text-xs)">
                <span className="text-text-secondary">今日</span>
                {node.trafficUnlimited ? (
                  <Tooltip content="无限流量" openOnClick>
                    <button
                      type="button"
                      data-card-interactive="1"
                      onClick={(event) => event.stopPropagation()}
                      className="cursor-help border-0 bg-transparent p-0 text-(length:--text-xs) text-text-secondary tabular-nums"
                    >
                      无限
                    </button>
                  </Tooltip>
                ) : node.trafficQuotaPercent != null ? (
                  <span
                    className="tabular-nums"
                    style={{ color: usageColor(node.trafficQuotaPercent) }}
                  >
                    <span className="sr-only">今日计费流量占配额 </span>
                    {node.trafficQuotaPercent}%
                  </span>
                ) : (
                  <span className="text-text-muted tabular-nums">无</span>
                )}
              </div>
              {node.traffic !== null ? (
                <div className="space-y-0.5 text-(length:--text-xs) leading-tight tabular-nums">
                  <div className="flex items-center gap-1 text-foreground">
                    <ArrowUp
                      size={12}
                      strokeWidth={2}
                      className="shrink-0 text-(--traffic-upload)"
                      aria-hidden="true"
                    />
                    <span className="sr-only">上行</span>
                    <span className="truncate">{node.trafficUploadLabel}</span>
                  </div>
                  <div className="flex items-center gap-1 text-text-secondary">
                    <ArrowDown
                      size={12}
                      strokeWidth={2}
                      className="shrink-0 text-(--traffic-download)"
                      aria-hidden="true"
                    />
                    <span className="sr-only">下行</span>
                    <span className="truncate">{node.trafficDownloadLabel}</span>
                  </div>
                </div>
              ) : (
                <span className="block text-(length:--text-xs) text-text-secondary">无数据</span>
              )}
            </div>
          </div>
        )}

        {/* Meta */}
        <div className="space-y-1 text-(length:--text-xs) text-text-secondary">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate" title={`引擎：${engineSummary}`}>
              引擎：{engineSummary}
            </span>
            <span className="shrink-0 tabular-nums">
              {node.state === 'online' && node.uptimeSampleHint ? (
                <Tooltip content={node.uptimeSampleHint} openOnClick>
                  <button
                    type="button"
                    data-card-interactive="1"
                    onClick={(event) => event.stopPropagation()}
                    className="cursor-help border-0 bg-transparent p-0 text-left text-(length:--text-xs) text-text-secondary underline decoration-dotted underline-offset-4"
                  >
                    {lastSeenSummary}
                  </button>
                </Tooltip>
              ) : (
                lastSeenSummary
              )}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 tabular-nums">
            <span className="min-w-0 truncate">费用：{node.cost}</span>
            <span
              title={node.expiry}
              className={`shrink-0 ${
                node.expiryTone === 'danger'
                  ? 'font-medium text-danger'
                  : node.expiryTone === 'warning'
                    ? 'font-medium text-warning'
                    : ''
              }`}
            >
              {node.expiryDate}
            </span>
          </div>
        </div>
      </div>

      {/* Footer Categories */}
      <div
        role="group"
        aria-label="分组与标签"
        className="mt-3 flex flex-wrap items-center justify-between gap-1.5 border-t-[1px] border-border-subtle pt-2.5"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
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
                data-card-interactive="1"
                onClick={(event) => event.stopPropagation()}
                aria-label={`其余 ${extraTags.length} 个标签：${extraTags.map((t) => t.name).join('、')}`}
                className="rounded-full border-[1px] border-border-subtle bg-surface-muted px-2 py-0.5 text-(length:--text-xs) text-text-secondary tabular-nums hover:border-border-strong hover:text-foreground"
              >
                +{extraTags.length}
              </button>
            </Tooltip>
          )}
        </div>
        {renderCategoryEditor ? (
          <div className="shrink-0" data-card-interactive="1">
            {renderCategoryEditor(node)}
          </div>
        ) : null}
      </div>
    </article>
  );
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
  batchMode = false,
  selectedKeys,
  onSelectionChange,
  onRowClick,
  onFilterByGroup,
  onFilterByTag,
  renderCategoryEditor,
  headerAction,
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
  batchMode?: boolean;
  selectedKeys?: string[];
  onSelectionChange?: (keys: string[]) => void;
  onRowClick?: (node: SummaryNode) => void;
  onFilterByGroup?: (groupId: string) => void;
  onFilterByTag?: (tagId: string) => void;
  renderCategoryEditor?: (node: SummaryNode) => ReactNode;
  headerAction?: ReactNode;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const visibleNodes = showAll || expanded ? nodes : nodes.slice(0, 5);
  const selectedSet = new Set(selectedKeys ?? []);
  const batchActive = batchMode || selectedSet.size > 0;

  function toggleSelect(nodeId: string) {
    if (!onSelectionChange) return;
    const next = selectedSet.has(nodeId)
      ? (selectedKeys ?? []).filter((key) => key !== nodeId)
      : [...(selectedKeys ?? []), nodeId];
    onSelectionChange(next);
  }

  let content: ReactNode;
  if (!loaded && loading) {
    content = <CardGridSkeleton count={showAll ? 6 : 3} cols="3col" label={`正在读取${caption}`} />;
  } else if (!loaded) {
    content = (
      <div className={plain ? '' : 'v-card'}>
        <EmptyStates headingLevel={3} compact variant="unknown" title="节点尚未读取" />
      </div>
    );
  } else if (visibleNodes.length === 0) {
    content = (
      <div className={plain ? '' : 'v-card'}>
        <EmptyStates headingLevel={3} compact title={emptyMessage} {...emptyState} />
      </div>
    );
  } else {
    content = (
      <div id={id} className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visibleNodes.map((node) => (
          <NodeCard
            key={node.id}
            node={node}
            selectable={selectable}
            batchActive={batchActive}
            selected={selectedSet.has(node.id)}
            onToggleSelect={toggleSelect}
            onRowClick={onRowClick}
            onFilterByGroup={onFilterByGroup}
            onFilterByTag={onFilterByTag}
            renderCategoryEditor={renderCategoryEditor}
          />
        ))}
      </div>
    );
  }

  if (plain) return content;

  if (!framed) {
    return (
      <section aria-label={caption} className="min-w-0 space-y-3">
        {content}
      </section>
    );
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-heading`} className="text-(length:--text-base) font-medium text-foreground">
          节点
        </h2>
        <div className="flex items-center gap-2">
          {!showAll && nodes.length > 5 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
              aria-expanded={expanded}
              aria-controls={id}
            >
              {expanded ? '收起节点' : `查看全部 ${nodes.length} 台`}
            </Button>
          )}
          {headerAction}
        </div>
      </div>
      {content}
    </section>
  );
}
