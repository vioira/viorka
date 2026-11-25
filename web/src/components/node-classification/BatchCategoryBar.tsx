import { Folder, Globe, Tag } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Session } from '@/api/auth';
import { ApiError } from '@/api/client';
import type { NodeRecord } from '@/api/nodes';
import { type Catalog, readCatalog } from '@/api/public-status';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { Checkbox } from '@/components/arc/checkbox/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/arc/popover/popover';
import { SearchField } from '@/components/arc/search-field/search-field';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import {
  applyCategoryOperations,
  buildCategorySteps,
  computeTriStateTags,
  PartialCategoryApplyError,
  type TriStateValue,
} from './category-mutations';

export function BatchCategoryBar({
  session,
  selectedNodes,
  filteredCount,
  catalog,
  onCatalogChange,
  onSelectAllFiltered,
  onClearSelection,
  onChange,
}: {
  session: Session;
  selectedNodes: NodeRecord[];
  filteredCount: number;
  catalog: Catalog | null;
  onCatalogChange: (catalog: Catalog) => void;
  onSelectAllFiltered: () => void;
  onClearSelection: () => void;
  onChange: () => void;
}) {
  const [groupOpen, setGroupOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { toast } = useToastStack();
  const [, reportError] = useToastFeedback('error', 'batch-node-classification');
  const [, reportSuccess] = useToastFeedback('success');

  const groups = useMemo(() => (catalog?.items ?? []).filter((c) => c.kind === 'group'), [catalog]);
  const tags = useMemo(() => (catalog?.items ?? []).filter((c) => c.kind === 'tag'), [catalog]);

  async function ensureCatalog(): Promise<Catalog> {
    if (catalog) return catalog;
    const next = await readCatalog();
    onCatalogChange(next);
    return next;
  }

  async function assignBatchGroup(targetGroupId: string) {
    if (busy || !selectedNodes.length) return;
    setBusy(true);
    reportError('');
    try {
      const activeCatalog = await ensureCatalog();
      const nextRev = await applyCategoryOperations({
        revision: activeCatalog.revision,
        nodeIds: selectedNodes.map((n) => n.id),
        steps: [{ action: 'group', category: targetGroupId }],
        csrfToken: session.csrf_token,
      });
      onCatalogChange({ ...activeCatalog, revision: nextRev });
      onChange();
      setGroupOpen(false);
      const groupName = targetGroupId
        ? (activeCatalog.items.find((c) => c.id === targetGroupId)?.name ?? '目标分组')
        : '未分组';
      reportSuccess(`已将 ${selectedNodes.length} 台节点设为“${groupName}”。`);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        toast({
          id: 'batch-cat-conflict',
          type: 'error',
          title: '分类目录版本已变更',
          description: cause.message,
          action: {
            label: '刷新目录',
            onClick: () => {
              void readCatalog()
                .then(onCatalogChange)
                .catch(() => {});
            },
          },
        });
      } else {
        reportError(cause instanceof Error ? cause.message : '批量分配分组失败。');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="region"
      aria-label="批量节点操作"
      className="flex flex-wrap items-center justify-between gap-3 rounded-(--radius-panel) border-[1px] border-(--table-row-selected-border) bg-(--table-row-selected) px-4 py-2.5"
    >
      <div className="flex flex-wrap items-center gap-2 text-(length:--text-sm)">
        <span className="font-medium text-foreground tabular-nums">
          已选择 {selectedNodes.length} 台节点
        </span>
        {selectedNodes.length < filteredCount && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={onSelectAllFiltered}>
            <span className="tabular-nums">全选筛选结果 ({filteredCount})</span>
          </Button>
        )}
        <Button variant="ghost" size="sm" disabled={busy} onClick={onClearSelection}>
          取消选择
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Popover open={groupOpen} onOpenChange={setGroupOpen}>
          <PopoverTrigger asChild>
            <Button variant="secondary" size="sm" disabled={busy}>
              <Folder size={15} aria-hidden="true" />
              分配分组
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-2!">
            <div className="space-y-1">
              <p className="px-2 py-1 text-(length:--text-xs) font-medium text-text-secondary">
                移动所选 {selectedNodes.length} 台节点到
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void assignBatchGroup('')}
                className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-(length:--text-xs) text-text-secondary hover:bg-surface-muted disabled:opacity-50"
              >
                <span>设为未分组</span>
              </button>
              <div className="my-1 border-t-[1px] border-border-subtle" />
              <div className="max-h-56 space-y-0.5 overflow-y-auto">
                {groups.length === 0 ? (
                  <p className="px-2.5 py-2 text-(length:--text-xs) text-text-secondary">
                    暂无可用分组，请先在“分组与标签”中创建。
                  </p>
                ) : (
                  groups.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      disabled={busy}
                      onClick={() => void assignBatchGroup(g.id)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-(length:--text-xs) text-foreground hover:bg-surface-muted disabled:opacity-50"
                    >
                      <span className="truncate">{g.name}</span>
                      {g.shared && (
                        <Globe size={13} className="shrink-0 text-success" aria-label="公开展示" />
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          </PopoverContent>
        </Popover>

        <Popover open={tagOpen} onOpenChange={setTagOpen}>
          <PopoverTrigger asChild>
            <Button variant="primary" size="sm" disabled={busy}>
              <Tag size={15} aria-hidden="true" />
              批量管理标签
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[min(22rem,calc(100vw-20px))] p-0!">
            {tagOpen && (
              <BatchTagsEditor
                session={session}
                selectedNodes={selectedNodes}
                tags={tags}
                catalog={catalog}
                onCatalogChange={onCatalogChange}
                onChange={onChange}
                onClose={() => setTagOpen(false)}
              />
            )}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

function BatchTagsEditor({
  session,
  selectedNodes,
  tags,
  catalog,
  onCatalogChange,
  onChange,
  onClose,
}: {
  session: Session;
  selectedNodes: NodeRecord[];
  tags: Catalog['items'];
  catalog: Catalog | null;
  onCatalogChange: (catalog: Catalog) => void;
  onChange: () => void;
  onClose: () => void;
}) {
  const triStates = useMemo(() => computeTriStateTags(selectedNodes, tags), [selectedNodes, tags]);
  const [draft, setDraft] = useState<Record<string, TriStateValue>>(() =>
    Object.fromEntries(triStates.map((item) => [item.category.id, item.initial])),
  );
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const { toast } = useToastStack();
  const [, reportError] = useToastFeedback('error', 'batch-node-tags');
  const [, reportSuccess] = useToastFeedback('success');

  const initialMap = useMemo(
    () => Object.fromEntries(triStates.map((item) => [item.category.id, item.initial])),
    [triStates],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLocaleLowerCase();
    return q ? triStates.filter((t) => t.category.name.toLocaleLowerCase().includes(q)) : triStates;
  }, [triStates, search]);

  const toAdd = useMemo(
    () =>
      triStates
        .filter((t) => initialMap[t.category.id] !== 'all' && draft[t.category.id] === 'all')
        .map((t) => t.category),
    [triStates, initialMap, draft],
  );
  const toRemove = useMemo(
    () =>
      triStates
        .filter((t) => initialMap[t.category.id] !== 'none' && draft[t.category.id] === 'none')
        .map((t) => t.category),
    [triStates, initialMap, draft],
  );

  async function apply() {
    if (busy || (!toAdd.length && !toRemove.length)) return;
    setBusy(true);
    reportError('');
    try {
      const activeCatalog = catalog ?? (await readCatalog());
      const steps = buildCategorySteps({
        addTagIds: toAdd.map((t) => t.id),
        removeTagIds: toRemove.map((t) => t.id),
      });
      const nextRev = await applyCategoryOperations({
        revision: activeCatalog.revision,
        nodeIds: selectedNodes.map((n) => n.id),
        steps,
        csrfToken: session.csrf_token,
      });
      onCatalogChange({ ...activeCatalog, revision: nextRev });
      onChange();
      reportSuccess(`已更新 ${selectedNodes.length} 台节点的标签。`);
      onClose();
    } catch (cause) {
      if (cause instanceof PartialCategoryApplyError) {
        onChange();
      }
      const conflict =
        (cause instanceof ApiError && cause.status === 409) ||
        (cause instanceof PartialCategoryApplyError &&
          cause.causeError instanceof ApiError &&
          cause.causeError.status === 409);
      if (conflict) {
        toast({
          id: 'batch-tags-conflict',
          type: 'error',
          title: '分类目录版本已变更',
          description: cause instanceof Error ? cause.message : '请重新读取最新目录后再试。',
          action: {
            label: '刷新目录',
            onClick: () => {
              void readCatalog()
                .then(onCatalogChange)
                .catch(() => {});
            },
          },
        });
      } else {
        reportError(cause instanceof Error ? cause.message : '批量更新标签失败。');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="divide-y-[1px] divide-border-subtle">
      <div className="px-4 py-3">
        <p className="text-(length:--text-sm) font-medium text-foreground">
          批量管理标签 ({selectedNodes.length} 台)
        </p>
        <p className="mt-0.5 text-(length:--text-xs) text-text-secondary">
          横线表示部分所选节点包含该标签
        </p>
      </div>
      <div className="space-y-3 p-4">
        {tags.length > 5 && (
          <SearchField
            hideLabel
            label="搜索标签"
            placeholder="筛选标签名称"
            value={search}
            onValueChange={setSearch}
          />
        )}
        <div className="max-h-56 space-y-2 overflow-y-auto rounded-(--radius-control) border-[1px] border-border-subtle bg-surface p-2">
          {visible.length === 0 ? (
            <p className="py-3 text-center text-(length:--text-xs) text-text-secondary">
              {tags.length ? '没有匹配的标签' : '暂无标签，请先在“分组与标签”中创建'}
            </p>
          ) : (
            visible.map(({ category, initial }) => {
              const current = draft[category.id] ?? initial;
              return (
                <div key={category.id} className="flex items-center justify-between gap-2">
                  <Checkbox
                    label={category.name}
                    disabled={busy}
                    checked={
                      current === 'all' ? true : current === 'mixed' ? 'indeterminate' : false
                    }
                    onCheckedChange={() => {
                      setDraft((prev) => {
                        const prevState = prev[category.id] ?? initial;
                        const nextState: TriStateValue =
                          prevState === 'mixed'
                            ? 'all'
                            : prevState === 'all'
                              ? 'none'
                              : initial === 'mixed'
                                ? 'mixed'
                                : 'all';
                        return { ...prev, [category.id]: nextState };
                      });
                    }}
                  />
                  {category.shared && (
                    <Badge tone="success" outline>
                      公开
                    </Badge>
                  )}
                </div>
              );
            })
          )}
        </div>
        {(toAdd.length > 0 || toRemove.length > 0) && (
          <div className="space-y-1 rounded-(--radius-control) border-[1px] border-border-subtle bg-surface-muted px-3 py-2 text-(length:--text-xs) text-text-secondary">
            {toAdd.length > 0 && (
              <p className="wrap-anywhere">添加：{toAdd.map((t) => t.name).join('、')}</p>
            )}
            {toRemove.length > 0 && (
              <p className="wrap-anywhere">移除：{toRemove.map((t) => t.name).join('、')}</p>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 px-4 py-3">
        <Button variant="secondary" size="sm" disabled={busy} onClick={onClose}>
          取消
        </Button>
        <Button
          variant="primary"
          size="sm"
          loading={busy}
          disabled={busy || (!toAdd.length && !toRemove.length)}
          onClick={() => void apply()}
        >
          应用变更
        </Button>
      </div>
    </div>
  );
}
