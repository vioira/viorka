import { Code2, Copy, History, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { deleteSubscriptionTemplate, type SubscriptionTemplate } from '@/api/subscriptions';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { DropdownMenu } from '@/components/arc/dropdown-menu/dropdown-menu';
import { SearchField } from '@/components/arc/search-field/search-field';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import DataTable from '@/components/data-table';
import TemplateHistoryDrawer from './components/TemplateHistoryDrawer';
import { useDialogFocus } from './components/useDialogFocus';
import { useSubscriptionsContext } from './context';

export default function SubscriptionTemplatesPage() {
  const { session, isAdmin, rules, templates, templatesLoading, reloadTemplates, reloadRules } =
    useSubscriptionsContext();
  const navigate = useNavigate();
  const { toast } = useToastStack();
  const focus = useDialogFocus();

  const [formatFilter, setFormatFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [historyTemplate, setHistoryTemplate] = useState<SubscriptionTemplate | null>(null);
  const [deleting, setDeleting] = useState<SubscriptionTemplate | null>(null);
  const [busy, setBusy] = useState(false);

  const visible = useMemo(
    () =>
      (templates ?? []).filter((item) => {
        if (formatFilter !== 'all' && item.format !== formatFilter) return false;
        const q = query.trim().toLowerCase();
        if (q && !`${item.name} ${item.format}`.toLowerCase().includes(q)) return false;
        return true;
      }),
    [templates, formatFilter, query],
  );

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

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
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
          <div className="min-w-0 flex-1 basis-56 max-w-xs">
            <SearchField
              label="搜索配置模板"
              hideLabel
              placeholder="搜索模板名称或格式"
              value={query}
              onValueChange={setQuery}
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

      <DataTable
        caption="配置模板"
        minWidth={760}
        loaded={templates !== null}
        loading={templatesLoading}
        emptyMessage={query || formatFilter !== 'all' ? '没有匹配的模板' : '暂无配置模板'}
        emptyState={{ variant: query || formatFilter !== 'all' ? 'no-results' : 'empty' }}
        rows={visible.map((item) => ({ ...item }))}
        rowKey="id"
        columns={[
          {
            key: 'name',
            label: '模板名称',
            render: (_, item) => (
              <div className="flex flex-wrap items-center gap-2">
                <span className="break-all font-medium">{item.name}</span>
                <Badge tone="neutral" size="sm">
                  {item.builtin ? '系统默认' : '自定义'}
                </Badge>
              </div>
            ),
          },
          {
            key: 'format',
            label: '配置格式',
            render: (_, item) => (
              <span className="font-mono text-(length:--text-xs)">{item.format}</span>
            ),
          },
          {
            key: 'replacements',
            label: '处理链路',
            sortable: false,
            render: (_, item) => (
              <div className="flex flex-wrap gap-1.5">
                <Badge tone="neutral" size="sm">
                  正文变量
                </Badge>
                {item.replacements.length > 0 && (
                  <Badge tone="info" size="sm" className="tabular-nums">
                    {item.replacements.length} 条正则
                  </Badge>
                )}
                {item.script && (
                  <Badge tone="info" size="sm">
                    JS 脚本
                  </Badge>
                )}
              </div>
            ),
          },
          {
            key: 'version',
            label: '版本',
            render: (_, item) => (
              <span className="text-(length:--text-xs) tabular-nums">v{item.version}</span>
            ),
          },
          {
            key: 'references',
            label: '关联规则',
            render: (_, item) => {
              const referencing = rules?.filter((rule) => rule.template_id === item.id) ?? [];
              return (
                <div className="max-w-64 break-words">
                  {item.references > 0 ? (
                    <>
                      <p className="tabular-nums">{item.references} 条规则引用</p>
                      {referencing.length > 0 && (
                        <p className="mt-1 text-(length:--text-xs) text-text-secondary">
                          {referencing.map((rule) => rule.name).join('、')}
                        </p>
                      )}
                    </>
                  ) : (
                    <span className="text-(length:--text-xs) text-text-secondary">尚未引用</span>
                  )}
                </div>
              );
            },
          },
          {
            key: 'actions',
            label: '操作',
            sortable: false,
            render: (_, item) =>
              isAdmin ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => setHistoryTemplate(item)}>
                    <History size={15} strokeWidth={1.75} aria-hidden="true" />
                    历史
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void navigate(`/subscriptions/templates/${item.id}/edit`)}
                  >
                    <Code2 size={15} strokeWidth={1.75} aria-hidden="true" />
                    工作台
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
              ) : (
                <span className="text-(length:--text-xs) text-text-secondary">只读</span>
              ),
          },
        ]}
      />

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
