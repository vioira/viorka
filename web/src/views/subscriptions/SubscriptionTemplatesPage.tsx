import { Code2, Copy, History, ListFilter, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { deleteSubscriptionTemplate, type SubscriptionTemplate } from '@/api/subscriptions';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { DropdownMenu } from '@/components/arc/dropdown-menu/dropdown-menu';
import { SearchField } from '@/components/arc/search-field/search-field';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { Select } from '@/components/arc/select/select';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { CardGridSkeleton, shouldHandleCardClick } from '@/components/card-kit';
import EmptyStates from '@/components/empty-states';
import TemplateHistoryDrawer from './components/TemplateHistoryDrawer';
import { useDialogFocus } from './components/useDialogFocus';
import { useSubscriptionsContext } from './context';

type TemplateSort = 'builtin' | 'version';

export default function SubscriptionTemplatesPage() {
  const { session, isAdmin, rules, templates, templatesLoading, reloadTemplates, reloadRules } =
    useSubscriptionsContext();
  const navigate = useNavigate();
  const { toast } = useToastStack();
  const focus = useDialogFocus();

  const [formatFilter, setFormatFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<TemplateSort>('builtin');
  const [historyTemplate, setHistoryTemplate] = useState<SubscriptionTemplate | null>(null);
  const [deleting, setDeleting] = useState<SubscriptionTemplate | null>(null);
  const [busy, setBusy] = useState(false);

  const visible = useMemo(() => {
    const filtered = (templates ?? []).filter((item) => {
      if (formatFilter !== 'all' && item.format !== formatFilter) return false;
      const q = query.trim().toLowerCase();
      if (q && !`${item.name} ${item.format}`.toLowerCase().includes(q)) return false;
      return true;
    });
    return [...filtered].sort((a, b) => {
      if (sort === 'version') {
        if (b.version !== a.version) return b.version - a.version;
      } else if (a.builtin !== b.builtin) {
        return a.builtin ? -1 : 1;
      }
      return a.name.localeCompare(b.name, 'zh-CN');
    });
  }, [templates, formatFilter, query, sort]);

  async function removeTemplate() {
    if (!deleting || busy) return;
    setBusy(true);
    try {
      await deleteSubscriptionTemplate(deleting, session);
      setDeleting(null);
      void reloadTemplates();
      void reloadRules();
      toast({ type: 'success', title: '配置模板已删除' });
    } catch (error) {
      toast({
        id: 'subscription-template-delete',
        type: 'error',
        title: '未能删除配置模板',
        description: error instanceof Error ? error.message : '请刷新引用状态后重试。',
      });
    } finally {
      setBusy(false);
    }
  }

  const hasFilter = Boolean(query) || formatFilter !== 'all';

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
          <SegmentedControl
            label="模板格式筛选"
            value={formatFilter}
            onValueChange={setFormatFilter}
            options={[
              { value: 'all', label: '全部' },
              { value: 'mihomo', label: 'Mihomo' },
              { value: 'sing-box', label: 'sing-box' },
              { value: 'loon', label: 'Loon' },
            ]}
          />
          <div className="min-w-40 max-w-xs flex-1 basis-48">
            <SearchField
              label="搜索配置模板"
              hideLabel
              placeholder="搜索模板名称或格式"
              value={query}
              onValueChange={setQuery}
            />
          </div>
          <div className="w-48">
            <Select
              hideLabel
              label="模板排序"
              value={sort}
              onValueChange={(value) => setSort(value as TemplateSort)}
              options={[
                { value: 'builtin', label: '排序：系统默认优先' },
                { value: 'version', label: '排序：版本号高到低' },
              ]}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            loading={templatesLoading}
            variant="secondary"
            disabled={templatesLoading}
            onClick={() => {
              void reloadTemplates();
              void reloadRules();
            }}
          >
            <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />
            刷新
          </Button>
          {isAdmin &&
            (templates ? (
              <DropdownMenu
                label="新建模板"
                icon={<Plus size={16} strokeWidth={1.75} aria-hidden="true" />}
                items={templates
                  .filter((item) => item.builtin)
                  .map((item) => ({
                    label: `基于 ${item.format} 默认模板`,
                    onSelect: () =>
                      void navigate(
                        `/subscriptions/templates/new?from=${encodeURIComponent(item.id)}`,
                      ),
                  }))}
              />
            ) : (
              <Button disabled>
                <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
                新建模板
              </Button>
            ))}
        </div>
      </div>

      <section aria-label="配置模板列表" className="min-w-0">
        {templates === null && templatesLoading ? (
          <CardGridSkeleton count={6} cols="3col" label="正在读取配置模板" />
        ) : templates === null ? (
          <div className="v-card">
            <EmptyStates headingLevel={3} compact variant="unknown" title="配置模板尚未读取" />
          </div>
        ) : visible.length === 0 ? (
          <div className="v-card">
            <EmptyStates
              headingLevel={3}
              compact
              variant={hasFilter ? 'no-results' : 'empty'}
              title={hasFilter ? '没有匹配的模板' : '暂无配置模板'}
              action={
                hasFilter ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setQuery('');
                      setFormatFilter('all');
                    }}
                  >
                    <ListFilter size={16} strokeWidth={1.75} aria-hidden="true" />
                    清除筛选
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((item) => {
              const referencing = rules?.filter((rule) => rule.template_id === item.id) ?? [];
              return (
                <article
                  key={item.id}
                  data-card="template"
                  onClick={(event) => {
                    if (isAdmin && shouldHandleCardClick(event)) {
                      void navigate(`/subscriptions/templates/${item.id}/edit`);
                    }
                  }}
                  className={`flex min-w-0 flex-col justify-between space-y-3 rounded-(--radius-surface) border-[1px] border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-surface-muted/30 ${
                    isAdmin ? 'cursor-pointer' : ''
                  }`}
                >
                  <div className="space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        {isAdmin ? (
                          <button
                            type="button"
                            data-card-interactive="1"
                            onClick={() =>
                              void navigate(`/subscriptions/templates/${item.id}/edit`)
                            }
                            className="text-left text-(length:--text-sm) font-medium text-foreground hover:text-accent hover:underline wrap-anywhere"
                          >
                            {item.name}
                          </button>
                        ) : (
                          <h3 className="text-(length:--text-sm) font-medium text-foreground wrap-anywhere">
                            {item.name}
                          </h3>
                        )}
                        <p className="mt-0.5 font-mono text-(length:--text-xs) text-text-secondary tabular-nums">
                          {item.format}，v{item.version}
                        </p>
                      </div>
                      <Badge size="sm" tone="neutral" className="shrink-0">
                        {item.builtin ? '系统默认' : '自定义'}
                      </Badge>
                    </div>

                    <div className="space-y-1.5 rounded-(--radius-control) border-[1px] border-border-subtle bg-surface-muted/50 p-3 text-(length:--text-xs)">
                      <p className="text-text-secondary">处理流水线</p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge size="sm" tone="neutral">
                          正文变量
                        </Badge>
                        {item.replacements.length > 0 && (
                          <>
                            <span className="text-text-muted" aria-hidden="true">
                              →
                            </span>
                            <Badge size="sm" tone="info" className="tabular-nums">
                              {item.replacements.length} 条正则
                            </Badge>
                          </>
                        )}
                        {item.script && (
                          <>
                            <span className="text-text-muted" aria-hidden="true">
                              →
                            </span>
                            <Badge size="sm" tone="info">
                              JS 脚本
                            </Badge>
                          </>
                        )}
                      </div>
                    </div>

                    <p className="text-(length:--text-xs) text-text-secondary wrap-anywhere">
                      {item.references > 0
                        ? referencing.length > 0
                          ? `关联规则（${item.references}）：${referencing.map((rule) => rule.name).join('、')}`
                          : `${item.references} 条规则引用`
                        : '尚未被规则引用'}
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-2 border-t-[1px] border-border-subtle pt-2.5">
                    {isAdmin ? (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          data-card-interactive="1"
                          onClick={() => void navigate(`/subscriptions/templates/${item.id}/edit`)}
                        >
                          <Code2 size={14} strokeWidth={1.75} aria-hidden="true" />
                          打开工作台
                        </Button>
                        <div className="flex items-center gap-1" data-card-interactive="1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setHistoryTemplate(item)}
                          >
                            <History size={14} strokeWidth={1.75} aria-hidden="true" />
                            版本历史
                          </Button>
                          <DropdownMenu
                            label="更多操作"
                            items={[
                              {
                                label: '复制为新模板',
                                icon: <Copy size={16} strokeWidth={1.75} aria-hidden="true" />,
                                onSelect: () =>
                                  void navigate(
                                    `/subscriptions/templates/new?from=${encodeURIComponent(item.id)}`,
                                  ),
                              },
                              {
                                label: item.builtin
                                  ? '默认模板不可删除'
                                  : item.references
                                    ? '移除规则引用后可删除'
                                    : '删除模板',
                                icon: <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />,
                                disabled: item.builtin || item.references > 0,
                                destructive: true,
                                separatorBefore: true,
                                onSelect: () => setDeleting(item),
                              },
                            ]}
                          />
                        </div>
                      </>
                    ) : (
                      <span className="text-(length:--text-xs) text-text-secondary">只读</span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <TemplateHistoryDrawer
        source={historyTemplate}
        session={session}
        onClose={() => setHistoryTemplate(null)}
        onRestored={() => {
          setHistoryTemplate(null);
          void reloadTemplates();
          void reloadRules();
        }}
      />

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
      >
        <DialogContent
          {...focus}
          data-subscription-management
          title="删除配置模板？"
          description={`将删除未被引用的模板“${deleting?.name ?? ''}”及其全部历史版本。`}
          footer={
            <>
              <Button variant="secondary" disabled={busy} onClick={() => setDeleting(null)}>
                取消
              </Button>
              <Button variant="danger" loading={busy} onClick={() => void removeTemplate()}>
                <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
                删除模板
              </Button>
            </>
          }
        />
      </Dialog>
    </div>
  );
}
