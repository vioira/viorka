import {
  Check,
  Filter,
  Folder,
  Pencil,
  Plus,
  RefreshCw,
  Tag,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Session } from '@/api/auth';
import { ApiError } from '@/api/client';
import type { NodeRecord } from '@/api/nodes';
import {
  assignCategories,
  type Catalog,
  type Category,
  readCatalog,
  saveCatalog,
} from '@/api/public-status';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { Checkbox } from '@/components/arc/checkbox/checkbox';
import { Drawer, DrawerContent, DrawerTrigger } from '@/components/arc/drawer/drawer';
import { Input } from '@/components/arc/input/input';
import { SearchField } from '@/components/arc/search-field/search-field';
import { Switch } from '@/components/arc/switch/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/arc/tabs/tabs';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import {
  catalogChanged,
  createCategoryId,
  MAX_ASSIGN_NODES,
  MAX_CATEGORY_ITEMS,
  MAX_CATEGORY_NAME_LENGTH,
  validateCategoryDraftName,
} from './category-mutations';

export function ClassificationDrawer({
  session,
  nodes,
  catalog,
  onCatalogChange,
  onChange,
  onFilterByCategory,
  triggerLabel = '分组与标签',
}: {
  session: Session;
  nodes: NodeRecord[];
  catalog: Catalog | null;
  onCatalogChange: (catalog: Catalog) => void;
  onChange: () => void;
  onFilterByCategory?: (category: Category) => void;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button variant="secondary">
          <Tag size={16} aria-hidden="true" />
          {triggerLabel}
        </Button>
      </DrawerTrigger>
      <DrawerContent
        side="right"
        title="分组与标签"
        titleDetail={catalog ? `版本 r${catalog.revision}` : undefined}
        description="每台节点至多归属 1 个分组，可叠加多个标签。开启公开展示后将在状态页展示。"
        className="[--drawer-size:min(36rem,calc(100vw-var(--space-4)))]"
      >
        {open && (
          <CatalogWorkspace
            session={session}
            nodes={nodes}
            initialCatalog={catalog}
            onCatalogChange={onCatalogChange}
            onChange={onChange}
            onFilterByCategory={(cat) => {
              onFilterByCategory?.(cat);
              setOpen(false);
            }}
          />
        )}
      </DrawerContent>
    </Drawer>
  );
}

function CatalogWorkspace({
  session,
  nodes,
  initialCatalog,
  onCatalogChange,
  onChange,
  onFilterByCategory,
}: {
  session: Session;
  nodes: NodeRecord[];
  initialCatalog: Catalog | null;
  onCatalogChange: (catalog: Catalog) => void;
  onChange: () => void;
  onFilterByCategory?: (category: Category) => void;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(initialCatalog);
  const [draft, setDraft] = useState<Category[]>(() => initialCatalog?.items ?? []);
  const [loading, setLoading] = useState(!initialCatalog);
  const [saving, setSaving] = useState(false);
  const [memberBusy, setMemberBusy] = useState(false);
  const [tab, setTab] = useState<Category['kind']>('group');
  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [newShared, setNewShared] = useState(false);
  const [formError, setFormError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [memberSearch, setMemberSearch] = useState('');
  const { toast } = useToastStack();
  const [, reportError] = useToastFeedback('error', 'classification-drawer');
  const [, reportSuccess] = useToastFeedback('success');

  async function reloadCatalog(preserveDraft = false) {
    setLoading(true);
    try {
      const next = await readCatalog();
      setCatalog(next);
      onCatalogChange(next);
      if (!preserveDraft) {
        setDraft(next.items);
        setEditingId(null);
        setDeletingId(null);
      }
      reportError('');
    } catch (cause) {
      reportError(cause instanceof Error ? cause.message : '无法读取分类目录，请重试。');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initialCatalog) {
      setCatalog(initialCatalog);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    readCatalog(controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setCatalog(next);
        setDraft(next.items);
        onCatalogChange(next);
        reportError('');
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          reportError(cause instanceof Error ? cause.message : '无法读取分类目录，请重试。');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [initialCatalog, onCatalogChange, reportError]);

  const dirty = useMemo(
    () => (catalog ? catalogChanged(catalog.items, draft) : false),
    [catalog, draft],
  );

  const persistedIds = useMemo(
    () => new Set(catalog?.items.map((item) => item.id) ?? []),
    [catalog],
  );

  const countsByKind = useMemo(
    () => ({
      group: draft.filter((item) => item.kind === 'group').length,
      tag: draft.filter((item) => item.kind === 'tag').length,
    }),
    [draft],
  );

  const memberCountById = useMemo(() => {
    const map = new Map<string, number>();
    for (const node of nodes) {
      for (const cat of node.categories ?? []) {
        map.set(cat.id, (map.get(cat.id) ?? 0) + 1);
      }
    }
    return map;
  }, [nodes]);

  const visibleItems = useMemo(() => {
    const q = search.trim().toLocaleLowerCase();
    return draft
      .filter((item) => item.kind === tab)
      .filter((item) => !q || item.name.toLocaleLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }, [draft, tab, search]);

  function addDraftItem() {
    if (draft.length >= MAX_CATEGORY_ITEMS) {
      setFormError(`分组与标签总数已达 ${MAX_CATEGORY_ITEMS} 项上限。`);
      return;
    }
    const error = validateCategoryDraftName(draft, tab, newName);
    if (error) {
      setFormError(error);
      return;
    }
    setFormError('');
    setDraft((prev) => [
      ...prev,
      {
        id: createCategoryId(),
        kind: tab,
        name: newName.trim(),
        shared: newShared,
      },
    ]);
    setNewName('');
    setNewShared(false);
  }

  function commitRename(item: Category) {
    const error = validateCategoryDraftName(draft, item.kind, editingName, item.id);
    if (error) {
      setFormError(error);
      return;
    }
    setFormError('');
    const nextName = editingName.trim();
    setDraft((prev) => prev.map((c) => (c.id === item.id ? { ...c, name: nextName } : c)));
    setEditingId(null);
  }

  async function saveCatalogChanges() {
    if (!catalog || saving || !dirty) return;
    setSaving(true);
    reportError('');
    try {
      const payload: Catalog = { revision: catalog.revision, items: draft };
      await saveCatalog(payload, session.csrf_token);
      const nextCatalog: Catalog = { revision: catalog.revision + 1, items: draft };
      setCatalog(nextCatalog);
      onCatalogChange(nextCatalog);
      onChange();
      setEditingId(null);
      setDeletingId(null);
      reportSuccess('分类目录已保存。');
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        toast({
          id: 'catalog-save-conflict',
          type: 'error',
          title: '分类目录已被其他会话修改',
          description: '您的本地草稿已保留。请读取最新版本后核对再保存。',
          action: {
            label: '读取最新版本',
            onClick: () => void reloadCatalog(false),
          },
        });
      } else {
        reportError(cause instanceof Error ? cause.message : '保存分类目录失败。');
      }
    } finally {
      setSaving(false);
    }
  }

  async function toggleMember(category: Category, node: NodeRecord, checked: boolean) {
    if (!catalog || memberBusy || nodes.length > MAX_ASSIGN_NODES) return;
    setMemberBusy(true);
    reportError('');
    try {
      const action = category.kind === 'group' ? 'group' : checked ? 'add' : 'remove';
      const target = category.kind === 'group' && !checked ? '' : category.id;
      await assignCategories(catalog.revision, [node.id], action, target, session.csrf_token);
      const next = { ...catalog, revision: catalog.revision + 1 };
      setCatalog(next);
      onCatalogChange(next);
      onChange();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        toast({
          id: 'catalog-member-conflict',
          type: 'error',
          title: '分类版本已变更',
          description: cause.message,
          action: {
            label: '刷新目录',
            onClick: () => void reloadCatalog(true),
          },
        });
      } else {
        reportError(cause instanceof Error ? cause.message : '更新节点归属失败。');
      }
    } finally {
      setMemberBusy(false);
    }
  }

  if (loading && !catalog) {
    return <p className="text-(length:--text-sm) text-text-secondary">正在读取分类目录…</p>;
  }

  if (!catalog) {
    return (
      <div className="space-y-3">
        <p className="text-(length:--text-sm) text-text-secondary">未能读取分类目录。</p>
        <Button variant="secondary" onClick={() => void reloadCatalog(false)}>
          <RefreshCw size={16} aria-hidden="true" />
          重新读取目录
        </Button>
      </div>
    );
  }

  const kindLabel = tab === 'group' ? '分组' : '标签';

  return (
    <div className="space-y-5">
      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value as Category['kind']);
          setFormError('');
          setEditingId(null);
          setDeletingId(null);
        }}
      >
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <TabsList borderless>
            <TabsTrigger value="group">
              <span className="inline-flex items-center gap-1.5">
                <Folder size={15} aria-hidden="true" />
                <span>分组</span>
                <span className="text-(length:--text-xs) text-text-secondary tabular-nums">
                  {countsByKind.group}
                </span>
              </span>
            </TabsTrigger>
            <TabsTrigger value="tag">
              <span className="inline-flex items-center gap-1.5">
                <Tag size={15} aria-hidden="true" />
                <span>标签</span>
                <span className="text-(length:--text-xs) text-text-secondary tabular-nums">
                  {countsByKind.tag}
                </span>
              </span>
            </TabsTrigger>
          </TabsList>

          <Button
            variant="ghost"
            size="sm"
            loading={loading}
            disabled={loading || saving}
            aria-label="刷新分类目录"
            onClick={() => void reloadCatalog(dirty)}
          >
            <RefreshCw size={15} aria-hidden="true" />
            刷新
          </Button>
        </div>

        <TabsContent value={tab} className="mt-4 space-y-4">
          <div className="space-y-3 rounded-(--radius-panel) border-[1px] border-border bg-surface p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-44 flex-1">
                <Input
                  hideLabel
                  label={`新建${kindLabel}名称`}
                  placeholder={`输入新${kindLabel}名称`}
                  maxLength={MAX_CATEGORY_NAME_LENGTH}
                  disabled={saving}
                  value={newName}
                  onChange={(event) => {
                    setNewName(event.target.value);
                    if (formError) setFormError('');
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addDraftItem();
                    }
                  }}
                />
              </div>
              <Button
                variant="primary"
                size="sm"
                disabled={saving || !newName.trim() || draft.length >= MAX_CATEGORY_ITEMS}
                onClick={addDraftItem}
              >
                <Plus size={15} aria-hidden="true" />
                新建{kindLabel}
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Switch
                label="在公开状态页展示"
                checked={newShared}
                disabled={saving}
                onCheckedChange={setNewShared}
              />
              <span className="text-(length:--text-xs) text-text-secondary tabular-nums">
                总容量 {draft.length} / {MAX_CATEGORY_ITEMS}
              </span>
            </div>
            {formError && (
              <p role="alert" className="text-(length:--text-xs) text-danger">
                {formError}
              </p>
            )}
          </div>

          <SearchField
            hideLabel
            label={`搜索${kindLabel}`}
            placeholder={`搜索${kindLabel}名称`}
            value={search}
            onValueChange={setSearch}
          />

          <div className="divide-y-[1px] divide-border-subtle rounded-(--radius-panel) border-[1px] border-border bg-surface">
            {visibleItems.length === 0 ? (
              <p className="p-6 text-center text-(length:--text-xs) text-text-secondary">
                {search.trim() ? `没有匹配的${kindLabel}` : `暂无${kindLabel}`}
              </p>
            ) : (
              visibleItems.map((item) => {
                const count = memberCountById.get(item.id) ?? 0;
                const persisted = persistedIds.has(item.id);
                const isEditing = editingId === item.id;
                const isDeleting = deletingId === item.id;
                const isExpanded = expandedId === item.id;
                const qMember = memberSearch.trim().toLocaleLowerCase();
                const visibleNodes = qMember
                  ? nodes.filter(
                      (n) =>
                        n.name.toLocaleLowerCase().includes(qMember) ||
                        n.id.toLocaleLowerCase().includes(qMember),
                    )
                  : nodes;

                return (
                  <div key={item.id} className="space-y-3 p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        {isEditing ? (
                          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                            <div className="min-w-36 flex-1">
                              <Input
                                hideLabel
                                label={`重命名${kindLabel}`}
                                maxLength={MAX_CATEGORY_NAME_LENGTH}
                                value={editingName}
                                onChange={(event) => {
                                  setEditingName(event.target.value);
                                  if (formError) setFormError('');
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault();
                                    commitRename(item);
                                  } else if (event.key === 'Escape') {
                                    setEditingId(null);
                                  }
                                }}
                              />
                            </div>
                            <Button variant="primary" size="sm" onClick={() => commitRename(item)}>
                              <Check size={14} aria-hidden="true" />
                              确定
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => setEditingId(null)}
                            >
                              <X size={14} aria-hidden="true" />
                              取消
                            </Button>
                          </div>
                        ) : (
                          <>
                            <span className="truncate font-medium text-foreground">
                              {item.name}
                            </span>
                            {!persisted && <Badge tone="info">未保存</Badge>}
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`重命名 ${item.name}`}
                              disabled={saving}
                              onClick={() => {
                                setEditingId(item.id);
                                setEditingName(item.name);
                                setDeletingId(null);
                              }}
                            >
                              <Pencil size={14} aria-hidden="true" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-expanded={isExpanded}
                              onClick={() => {
                                setExpandedId((curr) => (curr === item.id ? null : item.id));
                                setMemberSearch('');
                              }}
                            >
                              <Users size={14} aria-hidden="true" />
                              <span className="tabular-nums">{count} 台</span>
                            </Button>
                          </>
                        )}
                      </div>

                      {!isEditing && (
                        <div className="flex shrink-0 items-center gap-2">
                          <Switch
                            label="公开"
                            checked={item.shared}
                            disabled={saving}
                            onCheckedChange={(checked) => {
                              setDraft((prev) =>
                                prev.map((c) => (c.id === item.id ? { ...c, shared: checked } : c)),
                              );
                            }}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`删除 ${item.name}`}
                            disabled={saving}
                            onClick={() => {
                              setDeletingId(item.id);
                              setExpandedId(null);
                            }}
                          >
                            <Trash2 size={14} aria-hidden="true" />
                          </Button>
                        </div>
                      )}
                    </div>

                    {isDeleting && (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-(--radius-control) border-[1px] border-danger/40 bg-surface-muted p-3 text-(length:--text-xs)">
                        <span className="text-foreground">
                          删除“{item.name}”将解除 {count} 台节点的关联，节点本身保留。
                        </span>
                        <div className="flex items-center gap-2">
                          <Button variant="secondary" size="sm" onClick={() => setDeletingId(null)}>
                            取消
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => {
                              setDraft((prev) => prev.filter((c) => c.id !== item.id));
                              setDeletingId(null);
                            }}
                          >
                            确认删除
                          </Button>
                        </div>
                      </div>
                    )}

                    {isExpanded && (
                      <div className="space-y-2.5 rounded-(--radius-control) border-[1px] border-border-subtle bg-surface-muted p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-(length:--text-xs)">
                          <span className="font-medium text-foreground">关联节点 ({count})</span>
                          <div className="flex items-center gap-2">
                            {persisted && onFilterByCategory && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => onFilterByCategory(item)}
                              >
                                <Filter size={13} aria-hidden="true" />
                                列表筛选查看
                              </Button>
                            )}
                          </div>
                        </div>
                        {!persisted ? (
                          <p className="text-(length:--text-xs) text-text-secondary">
                            请先点击底部“保存目录”，再调整该{kindLabel}的关联节点。
                          </p>
                        ) : nodes.length === 0 ? (
                          <p className="text-(length:--text-xs) text-text-secondary">暂无节点。</p>
                        ) : (
                          <>
                            {nodes.length > 6 && (
                              <SearchField
                                hideLabel
                                label="搜索节点"
                                placeholder="按节点名或 ID 筛选"
                                value={memberSearch}
                                onValueChange={setMemberSearch}
                              />
                            )}
                            <div className="grid max-h-44 gap-2 overflow-y-auto sm:grid-cols-2">
                              {visibleNodes.map((n) => {
                                const has = n.categories?.some((c) => c.id === item.id) ?? false;
                                const otherGroup =
                                  item.kind === 'group'
                                    ? n.categories?.find(
                                        (c) => c.kind === 'group' && c.id !== item.id,
                                      )
                                    : undefined;
                                return (
                                  <Checkbox
                                    key={n.id}
                                    label={n.name}
                                    description={
                                      otherGroup ? `当前分组：${otherGroup.name}` : undefined
                                    }
                                    checked={has}
                                    disabled={memberBusy}
                                    onCheckedChange={(v) => void toggleMember(item, n, v === true)}
                                  />
                                );
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </TabsContent>
      </Tabs>

      {dirty && (
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-(--radius-panel) border-[1px] border-border bg-surface-raised p-3.5">
          <span className="text-(length:--text-xs) text-text-secondary">目录存在未保存修改</span>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={saving}
              onClick={() => {
                setDraft(catalog.items);
                setEditingId(null);
                setDeletingId(null);
                setFormError('');
              }}
            >
              还原
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={saving}
              disabled={saving}
              onClick={() => void saveCatalogChanges()}
            >
              保存目录
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
