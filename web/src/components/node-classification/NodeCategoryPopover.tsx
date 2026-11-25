import { Check, Folder, Globe, Pencil, Plus } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import type { Session } from '@/api/auth';
import { ApiError } from '@/api/client';
import type { NodeRecord } from '@/api/nodes';
import { type Catalog, type Category, readCatalog, saveCatalog } from '@/api/public-status';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { Checkbox } from '@/components/arc/checkbox/checkbox';
import { Input } from '@/components/arc/input/input';
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from '@/components/arc/popover/popover';
import { SearchField } from '@/components/arc/search-field/search-field';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import {
  applyCategoryOperations,
  buildCategorySteps,
  createCategoryId,
  MAX_CATEGORY_ITEMS,
  MAX_CATEGORY_NAME_LENGTH,
  PartialCategoryApplyError,
  validateCategoryDraftName,
} from './category-mutations';

export function NodeCategoryPopover({
  session,
  node,
  catalog,
  onCatalogChange,
  onChange,
  trigger,
  align = 'end',
}: {
  session: Session;
  node: NodeRecord;
  catalog: Catalog | null;
  onCatalogChange?: (catalog: Catalog) => void;
  onChange: () => void;
  trigger?: ReactNode;
  align?: 'start' | 'center' | 'end';
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button
            variant="ghost"
            size="sm"
            className="size-6! min-h-6! p-0!"
            aria-label={`编辑 ${node.name} 的分组与标签`}
            onClick={(event) => event.stopPropagation()}
          >
            <Pencil size={13} aria-hidden="true" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-[min(22rem,calc(100vw-20px))] p-0!"
        onClick={(event) => event.stopPropagation()}
      >
        {open && (
          <NodeCategoryEditor
            session={session}
            node={node}
            initialCatalog={catalog}
            onCatalogChange={onCatalogChange}
            onChange={onChange}
            onClose={() => setOpen(false)}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function NodeCategoryEditor({
  session,
  node,
  initialCatalog,
  onCatalogChange,
  onChange,
  onClose,
}: {
  session: Session;
  node: NodeRecord;
  initialCatalog: Catalog | null;
  onCatalogChange?: (catalog: Catalog) => void;
  onChange: () => void;
  onClose: () => void;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(initialCatalog);
  const [loadingCatalog, setLoadingCatalog] = useState(!initialCatalog);
  const [reloadEpoch, setReloadEpoch] = useState(0);
  const [busy, setBusy] = useState(false);
  const [tagSearch, setTagSearch] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [pendingItems, setPendingItems] = useState<Category[]>([]);

  const savedGroupId = useMemo(
    () => node.categories?.find((c) => c.kind === 'group')?.id ?? '',
    [node.categories],
  );
  const savedTagIds = useMemo(
    () => new Set(node.categories?.filter((c) => c.kind === 'tag').map((c) => c.id) ?? []),
    [node.categories],
  );

  const [groupId, setGroupId] = useState(savedGroupId);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(() => new Set(savedTagIds));
  const [validationError, setValidationError] = useState('');
  const { toast } = useToastStack();
  const [, reportError] = useToastFeedback('error', `node-cat-pop-${node.id}`);
  const [, reportSuccess] = useToastFeedback('success');

  useEffect(() => {
    if (initialCatalog && reloadEpoch === 0) {
      setCatalog(initialCatalog);
      setLoadingCatalog(false);
      return;
    }
    const controller = new AbortController();
    setLoadingCatalog(true);
    readCatalog(controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setCatalog(next);
        onCatalogChange?.(next);
        reportError('');
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          reportError(cause instanceof Error ? cause.message : '无法读取分类目录，请重试。');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingCatalog(false);
      });
    return () => controller.abort();
  }, [initialCatalog, reloadEpoch, onCatalogChange, reportError]);

  const allItems = useMemo(
    () => [...(catalog?.items ?? []), ...pendingItems],
    [catalog, pendingItems],
  );
  const groups = useMemo(() => allItems.filter((c) => c.kind === 'group'), [allItems]);
  const tags = useMemo(() => allItems.filter((c) => c.kind === 'tag'), [allItems]);
  const visibleTags = useMemo(() => {
    const q = tagSearch.trim().toLocaleLowerCase();
    return q ? tags.filter((t) => t.name.toLocaleLowerCase().includes(q)) : tags;
  }, [tags, tagSearch]);

  const dirty = useMemo(() => {
    if (groupId !== savedGroupId) return true;
    if (selectedTags.size !== savedTagIds.size) return true;
    for (const id of selectedTags) {
      if (!savedTagIds.has(id)) return true;
    }
    return false;
  }, [groupId, savedGroupId, selectedTags, savedTagIds]);

  function addDraftCategory(kind: Category['kind'], rawName: string) {
    if (allItems.length >= MAX_CATEGORY_ITEMS) {
      setValidationError(`分组与标签总数已达 ${MAX_CATEGORY_ITEMS} 项上限。`);
      return;
    }
    const invalid = validateCategoryDraftName(allItems, kind, rawName);
    if (invalid) {
      setValidationError(invalid);
      return;
    }
    setValidationError('');
    const item: Category = {
      id: createCategoryId(),
      kind,
      name: rawName.trim(),
      shared: false,
    };
    setPendingItems((prev) => [...prev, item]);
    if (kind === 'group') {
      setGroupId(item.id);
      setNewGroupName('');
    } else {
      setSelectedTags((prev) => new Set([...prev, item.id]));
      setNewTagName('');
    }
  }

  async function apply() {
    if (!catalog || busy || !dirty) return;
    setBusy(true);
    setValidationError('');
    reportError('');
    try {
      let latestCatalog = catalog;
      const usedPending = pendingItems.filter(
        (item) =>
          (item.kind === 'group' && groupId === item.id) ||
          (item.kind === 'tag' && selectedTags.has(item.id)),
      );
      if (usedPending.length > 0) {
        const nextCatalog: Catalog = {
          revision: latestCatalog.revision,
          items: [...latestCatalog.items, ...usedPending],
        };
        await saveCatalog(nextCatalog, session.csrf_token);
        latestCatalog = { ...nextCatalog, revision: latestCatalog.revision + 1 };
        setCatalog(latestCatalog);
        setPendingItems([]);
        onCatalogChange?.(latestCatalog);
      }

      const addTagIds = [...selectedTags].filter((id) => !savedTagIds.has(id));
      const removeTagIds = [...savedTagIds].filter((id) => !selectedTags.has(id));
      const steps = buildCategorySteps({
        groupId: groupId !== savedGroupId ? groupId : undefined,
        addTagIds,
        removeTagIds,
      });

      const nextRev = await applyCategoryOperations({
        revision: latestCatalog.revision,
        nodeIds: [node.id],
        steps,
        csrfToken: session.csrf_token,
      });
      const updated = { ...latestCatalog, revision: nextRev };
      setCatalog(updated);
      onCatalogChange?.(updated);
      onChange();
      reportSuccess(`已更新“${node.name}”的分组与标签。`);
      onClose();
    } catch (cause) {
      const conflict =
        (cause instanceof ApiError && cause.status === 409) ||
        (cause instanceof PartialCategoryApplyError &&
          cause.causeError instanceof ApiError &&
          cause.causeError.status === 409);
      if (cause instanceof PartialCategoryApplyError) {
        onChange();
      }
      if (conflict) {
        toast({
          id: `node-cat-conflict-${node.id}`,
          type: 'error',
          title: '分类目录版本已变更',
          description: cause instanceof Error ? cause.message : '请重新读取最新目录后再试。',
          action: {
            label: '刷新目录',
            onClick: () => setReloadEpoch((v) => v + 1),
          },
        });
      } else {
        reportError(cause instanceof Error ? cause.message : '更新分类失败，请重试。');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="divide-y-[1px] divide-border-subtle text-(length:--text-sm)">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <span className="min-w-0 truncate font-medium text-foreground">{node.name}</span>
        <PopoverClose asChild>
          <Button variant="ghost" size="sm" disabled={busy}>
            关闭
          </Button>
        </PopoverClose>
      </div>

      {loadingCatalog || !catalog ? (
        <div className="space-y-3 p-4">
          <p className="text-(length:--text-xs) text-text-secondary">
            {loadingCatalog ? '正在读取分类目录…' : '目录尚未读取。'}
          </p>
          {!loadingCatalog && (
            <Button variant="secondary" size="sm" onClick={() => setReloadEpoch((v) => v + 1)}>
              重新读取
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="max-h-[60vh] space-y-4 overflow-y-auto p-4">
            <fieldset disabled={busy} className="space-y-2">
              <legend className="text-(length:--text-xs) font-medium text-text-secondary">
                所属分组（单选）
              </legend>
              <div
                role="radiogroup"
                aria-label="所属分组"
                className="max-h-36 space-y-1 overflow-y-auto rounded-(--radius-control) border-[1px] border-border-subtle bg-surface p-1"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={groupId === ''}
                  onClick={() => setGroupId('')}
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-(length:--text-xs) ${
                    groupId === ''
                      ? 'bg-(--accent-subtle) font-medium text-foreground'
                      : 'text-text-secondary hover:bg-surface-muted'
                  }`}
                >
                  <span>未分组</span>
                  {groupId === '' && <Check size={14} aria-hidden="true" />}
                </button>
                {groups.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    role="radio"
                    aria-checked={groupId === g.id}
                    onClick={() => setGroupId(g.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-(length:--text-xs) ${
                      groupId === g.id
                        ? 'bg-(--accent-subtle) font-medium text-foreground'
                        : 'text-foreground hover:bg-surface-muted'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Folder size={13} className="shrink-0 text-text-muted" aria-hidden="true" />
                      <span className="truncate">{g.name}</span>
                      {g.shared && (
                        <Globe
                          size={12}
                          className="shrink-0 text-success"
                          aria-label="在公开状态页展示"
                        />
                      )}
                    </span>
                    {groupId === g.id && (
                      <Check size={14} className="shrink-0" aria-hidden="true" />
                    )}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <div className="min-w-0 flex-1">
                  <Input
                    hideLabel
                    label="快速新建分组"
                    placeholder="新建分组名称"
                    maxLength={MAX_CATEGORY_NAME_LENGTH}
                    value={newGroupName}
                    onChange={(event) => {
                      setNewGroupName(event.target.value);
                      if (validationError) setValidationError('');
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        addDraftCategory('group', newGroupName);
                      }
                    }}
                  />
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!newGroupName.trim()}
                  onClick={() => addDraftCategory('group', newGroupName)}
                >
                  <Plus size={14} aria-hidden="true" />
                  新建
                </Button>
              </div>
            </fieldset>

            <fieldset disabled={busy} className="space-y-2">
              <legend className="text-(length:--text-xs) font-medium text-text-secondary">
                节点标签（多选）
              </legend>
              {tags.length > 5 && (
                <SearchField
                  hideLabel
                  label="筛选标签"
                  placeholder="搜索已有标签"
                  value={tagSearch}
                  onValueChange={setTagSearch}
                />
              )}
              <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-(--radius-control) border-[1px] border-border-subtle bg-surface p-2">
                {visibleTags.length === 0 ? (
                  <p className="py-2 text-center text-(length:--text-xs) text-text-secondary">
                    {tags.length ? '没有匹配的标签' : '暂无标签，可在下方直接创建'}
                  </p>
                ) : (
                  visibleTags.map((tag) => (
                    <div key={tag.id} className="flex items-center justify-between gap-2">
                      <Checkbox
                        label={tag.name}
                        checked={selectedTags.has(tag.id)}
                        onCheckedChange={(checked) => {
                          setSelectedTags((prev) => {
                            const next = new Set(prev);
                            if (checked === true) next.add(tag.id);
                            else next.delete(tag.id);
                            return next;
                          });
                        }}
                      />
                      {tag.shared && (
                        <Badge tone="success" outline>
                          公开
                        </Badge>
                      )}
                    </div>
                  ))
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <div className="min-w-0 flex-1">
                  <Input
                    hideLabel
                    label="快速新建标签"
                    placeholder="新建标签名称"
                    maxLength={MAX_CATEGORY_NAME_LENGTH}
                    value={newTagName}
                    onChange={(event) => {
                      setNewTagName(event.target.value);
                      if (validationError) setValidationError('');
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        addDraftCategory('tag', newTagName);
                      }
                    }}
                  />
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!newTagName.trim()}
                  onClick={() => addDraftCategory('tag', newTagName)}
                >
                  <Plus size={14} aria-hidden="true" />
                  添加
                </Button>
              </div>
            </fieldset>

            {validationError && (
              <p role="alert" className="text-(length:--text-xs) text-danger">
                {validationError}
              </p>
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
              disabled={busy || !dirty}
              onClick={() => void apply()}
            >
              应用更改
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
