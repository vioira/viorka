import {
  ArrowDown,
  ArrowUp,
  ArrowUpToLine,
  Globe,
  GripVertical,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { type DragEvent, useState } from 'react';
import type { NodeRecord } from '@/api/nodes';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { DropdownMenu } from '@/components/arc/dropdown-menu/dropdown-menu';
import { Input } from '@/components/arc/input/input';
import { CountryFlag } from '@/components/country-flag';
import EmptyStates from '@/components/empty-states';
import { NodeOSIcon } from '@/components/node-os-icon';
import NodeStatus from '@/components/node-status';
import {
  countInvalidDraftNodes,
  type DraftNode,
  MAX_ALIAS_LENGTH,
  MAX_CPU_CORES,
  MAX_PUBLISHED_NODES,
  splitNodeCategories,
  validateAlias,
  validateCpuCores,
} from './status-publication';

export default function StatusPublishedList({
  entries,
  nodeMap,
  savedIds,
  onlineCount,
  disabled,
  onUpdateNode,
  onMoveNode,
  onRemoveNode,
  onAddAllOnline,
  onSortByAlias,
  onSortOnlineFirst,
  onResetAliases,
  onClearAll,
}: {
  entries: DraftNode[];
  nodeMap: ReadonlyMap<string, NodeRecord>;
  savedIds: ReadonlySet<string>;
  onlineCount: number;
  disabled: boolean;
  onUpdateNode: (id: string, patch: Partial<Pick<DraftNode, 'alias' | 'cpuCoresInput'>>) => void;
  onMoveNode: (fromIndex: number, toIndex: number) => void;
  onRemoveNode: (id: string) => void;
  onAddAllOnline: () => void;
  onSortByAlias: () => void;
  onSortOnlineFirst: () => void;
  onResetAliases: () => void;
  onClearAll: () => void;
}) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<{ id: string; position: 'before' | 'after' } | null>(
    null,
  );
  const [announcement, setAnnouncement] = useState('');

  const invalidCount = countInvalidDraftNodes(entries);

  function moveAndAnnounce(entry: DraftNode, fromIndex: number, toIndex: number, label: string) {
    onMoveNode(fromIndex, toIndex);
    const displayName = entry.alias.trim() || nodeMap.get(entry.id)?.name || entry.id;
    setAnnouncement(`已将 ${displayName}${label}`);
  }

  function handleDragStart(event: DragEvent<HTMLSpanElement>, id: string) {
    if (disabled) return;
    setDraggedId(id);
    const row = event.currentTarget.closest('li');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', id);
      if (row) event.dataTransfer.setDragImage(row, 24, 24);
    }
  }

  function handleDragOver(event: DragEvent<HTMLLIElement>, targetId: string) {
    if (!draggedId || draggedId === targetId || disabled) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget.getBoundingClientRect();
    const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    setDragTarget((current) =>
      current?.id === targetId && current.position === position
        ? current
        : { id: targetId, position },
    );
  }

  function handleDrop(event: DragEvent<HTMLLIElement>, targetId: string, targetIndex: number) {
    event.preventDefault();
    const sourceId = draggedId ?? event.dataTransfer?.getData('text/plain');
    if (!sourceId || sourceId === targetId || disabled) {
      setDraggedId(null);
      setDragTarget(null);
      return;
    }
    const fromIndex = entries.findIndex((item) => item.id === sourceId);
    if (fromIndex < 0) {
      setDraggedId(null);
      setDragTarget(null);
      return;
    }
    const position = dragTarget?.id === targetId ? dragTarget.position : 'before';
    let toIndex = position === 'before' ? targetIndex : targetIndex + 1;
    if (fromIndex < toIndex) toIndex -= 1;
    toIndex = Math.max(0, Math.min(entries.length - 1, toIndex));
    if (fromIndex !== toIndex) {
      const moved = entries[fromIndex];
      onMoveNode(fromIndex, toIndex);
      if (moved) {
        const displayName = moved.alias.trim() || nodeMap.get(moved.id)?.name || moved.id;
        setAnnouncement(`已将 ${displayName} 移至第 ${toIndex + 1} 位`);
      }
    }
    setDraggedId(null);
    setDragTarget(null);
  }

  return (
    <section className="v-card space-y-4" aria-label="已公开节点编排">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-(length:--text-base) font-medium text-foreground">
              已公开节点与展示顺序
            </h3>
            <span className="text-(length:--text-xs) text-text-secondary tabular-nums">
              {entries.length} / {MAX_PUBLISHED_NODES}
            </span>
            {invalidCount > 0 && (
              <Badge tone="danger" size="sm">
                {invalidCount} 项待修正
              </Badge>
            )}
          </div>
          <p className="mt-1 text-(length:--text-xs) text-text-secondary">
            访客默认按此顺序浏览节点卡片。仅已开启公开展示的分组与标签会显示在状态页。
          </p>
        </div>

        {entries.length > 0 && (
          <DropdownMenu
            label="批量整理"
            icon={<SlidersHorizontal size={15} aria-hidden="true" />}
            items={[
              {
                label: '按别名排序',
                disabled: disabled || entries.length < 2,
                onSelect: onSortByAlias,
              },
              {
                label: '在线节点排前',
                disabled: disabled || entries.length < 2,
                onSelect: onSortOnlineFirst,
              },
              {
                label: '恢复全部节点原名',
                icon: <RotateCcw size={14} aria-hidden="true" />,
                disabled,
                onSelect: onResetAliases,
              },
              {
                label: '清空已选列表',
                icon: <Trash2 size={14} aria-hidden="true" />,
                destructive: true,
                separatorBefore: true,
                disabled,
                onSelect: onClearAll,
              },
            ]}
          />
        )}
      </div>

      {entries.length === 0 ? (
        <EmptyStates
          headingLevel={3}
          compact
          variant="empty"
          title="尚未选择公开节点"
          description="从可选节点列表中勾选需要对外展示的节点，至少选择 1 台后可发布状态页。"
          action={
            onlineCount > 0 ? (
              <Button
                type="button"
                variant="secondary"
                disabled={disabled}
                onClick={onAddAllOnline}
              >
                <Plus size={16} aria-hidden="true" />
                添加全部在线节点 ({Math.min(onlineCount, MAX_PUBLISHED_NODES)})
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ol className="divide-y-[1px] divide-border-subtle rounded-(--radius-control) border-[1px] border-border bg-surface-raised">
          {entries.map((entry, index) => {
            const node = nodeMap.get(entry.id);
            const displayLabel = entry.alias.trim() || node?.name || entry.id;
            const aliasError = validateAlias(entry.alias);
            const cpuCoresError = validateCpuCores(entry.cpuCoresInput);
            const { publicGroup, privateGroup, publicTags } = splitNodeCategories(node?.categories);
            const isDragged = draggedId === entry.id;
            const dropBefore = dragTarget?.id === entry.id && dragTarget.position === 'before';
            const dropAfter = dragTarget?.id === entry.id && dragTarget.position === 'after';

            return (
              <li
                key={entry.id}
                onDragOver={(event) => handleDragOver(event, entry.id)}
                onDragLeave={() => {
                  if (dragTarget?.id === entry.id) setDragTarget(null);
                }}
                onDrop={(event) => handleDrop(event, entry.id, index)}
                className={`p-3.5 sm:p-4 transition-colors duration-150 ${
                  isDragged ? 'opacity-55' : ''
                } ${dropBefore ? 'shadow-[inset_0_2px_0_0_var(--accent)]' : ''} ${
                  dropAfter ? 'shadow-[inset_0_-2px_0_0_var(--accent)]' : ''
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    <span
                      aria-hidden="true"
                      draggable={!disabled}
                      onDragStart={(event) => handleDragStart(event, entry.id)}
                      onDragEnd={() => {
                        setDraggedId(null);
                        setDragTarget(null);
                      }}
                      title="拖拽调整展示顺序"
                      className={`inline-flex items-center text-text-muted ${
                        disabled
                          ? 'cursor-not-allowed opacity-50'
                          : 'cursor-grab active:cursor-grabbing hover:text-foreground'
                      }`}
                    >
                      <GripVertical size={16} />
                    </span>

                    <span className="min-w-6 text-(length:--text-xs) font-medium text-text-secondary tabular-nums">
                      #{index + 1}
                    </span>

                    <CountryFlag code={node?.location?.country_code} />
                    <NodeOSIcon os={node?.inventory?.os_name || node?.os || ''} />

                    <span className="min-w-0 truncate font-medium text-foreground">
                      {node?.name ?? entry.id}
                    </span>

                    <span className="text-(length:--text-xs)">
                      {node ? (
                        <NodeStatus state={node.state} showLastSeen={false} />
                      ) : (
                        <Badge tone="warning" size="sm">
                          节点信息未找到
                        </Badge>
                      )}
                    </span>

                    {!savedIds.has(entry.id) && (
                      <Badge tone="info" size="sm">
                        新增
                      </Badge>
                    )}

                    {publicGroup && (
                      <Badge
                        tone="neutral"
                        outline
                        size="sm"
                        icon={<Globe size={11} aria-hidden="true" />}
                      >
                        {publicGroup.name}
                      </Badge>
                    )}

                    {publicTags.slice(0, 2).map((tag) => (
                      <Badge key={tag.id} size="sm">
                        {tag.name}
                      </Badge>
                    ))}
                    {publicTags.length > 2 && (
                      <span className="text-(length:--text-xs) text-text-secondary tabular-nums">
                        +{publicTags.length - 2}
                      </span>
                    )}

                    {!publicGroup && privateGroup && (
                      <span className="text-(length:--text-xs) text-text-muted">
                        分组“{privateGroup.name}”未公开
                      </span>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      title="移至首位"
                      aria-label={`将 ${displayLabel} 移至首位`}
                      disabled={disabled || index === 0}
                      onClick={() => moveAndAnnounce(entry, index, 0, '移至第 1 位')}
                    >
                      <ArrowUpToLine size={15} aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      title="上移"
                      aria-label={`上移 ${displayLabel}`}
                      disabled={disabled || index === 0}
                      onClick={() =>
                        moveAndAnnounce(entry, index, index - 1, `上移至第 ${index} 位`)
                      }
                    >
                      <ArrowUp size={15} aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      title="下移"
                      aria-label={`下移 ${displayLabel}`}
                      disabled={disabled || index === entries.length - 1}
                      onClick={() =>
                        moveAndAnnounce(entry, index, index + 1, `下移至第 ${index + 2} 位`)
                      }
                    >
                      <ArrowDown size={15} aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      title="从公开列表移除"
                      aria-label={`移除 ${displayLabel}`}
                      disabled={disabled}
                      onClick={() => {
                        onRemoveNode(entry.id);
                        setAnnouncement(`已将 ${displayNameFor(entry, node)} 从公开列表移除`);
                      }}
                    >
                      <X size={15} aria-hidden="true" />
                    </Button>
                  </div>
                </div>

                <div className="mt-3 grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
                  <Input
                    label="公开别名"
                    maxLength={MAX_ALIAS_LENGTH}
                    value={entry.alias}
                    error={aliasError || undefined}
                    disabled={disabled}
                    onChange={(event) => onUpdateNode(entry.id, { alias: event.target.value })}
                    onBlur={(event) => {
                      const trimmed = event.target.value.trim();
                      if (trimmed && trimmed !== event.target.value) {
                        onUpdateNode(entry.id, { alias: trimmed });
                      }
                    }}
                  />
                  <Input
                    label="CPU 核数（可选）"
                    type="number"
                    min={1}
                    max={MAX_CPU_CORES}
                    step={1}
                    placeholder="留空不显示"
                    className="tabular-nums"
                    value={entry.cpuCoresInput}
                    error={cpuCoresError || undefined}
                    disabled={disabled}
                    onChange={(event) =>
                      onUpdateNode(entry.id, { cpuCoresInput: event.target.value })
                    }
                  />
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}

function displayNameFor(entry: DraftNode, node: NodeRecord | undefined): string {
  return entry.alias.trim() || node?.name || entry.id;
}
