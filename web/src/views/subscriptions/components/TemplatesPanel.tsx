import { Copy, History, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { Session } from '@/api/auth';
import {
  deleteSubscriptionTemplate,
  type SubscriptionRule,
  type SubscriptionTemplate,
} from '@/api/subscriptions';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { DropdownMenu } from '@/components/arc/dropdown-menu/dropdown-menu';
import { SearchField } from '@/components/arc/search-field/search-field';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import DataTable from '@/components/data-table';
import TemplateEditor from './TemplateEditor';
import TemplateHistoryDialog from './TemplateHistoryDialog';
import { useDialogFocus } from './useDialogFocus';

export default function TemplatesPanel({
  templates,
  rules,
  loading,
  session,
  onChanged,
}: {
  templates: SubscriptionTemplate[] | null;
  rules: SubscriptionRule[] | null;
  loading: boolean;
  session: Session;
  onChanged: () => void;
}) {
  const { toast } = useToastStack();
  const focus = useDialogFocus();
  const [editing, setEditing] = useState<{
    source: SubscriptionTemplate;
    existing: boolean;
  } | null>(null);
  const [history, setHistory] = useState<SubscriptionTemplate | null>(null);
  const [deleting, setDeleting] = useState<SubscriptionTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const admin = session.user.role === 'admin';
  async function remove() {
    if (!deleting || busy) return;
    setBusy(true);
    try {
      await deleteSubscriptionTemplate(deleting, session);
      setDeleting(null);
      onChanged();
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
  if (editing)
    return (
      <TemplateEditor
        source={editing.source}
        existing={editing.existing}
        session={session}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          onChanged();
        }}
      />
    );
  const visible = (templates ?? []).filter((item) =>
    `${item.name} ${item.format}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 max-w-md flex-1 basis-64">
          <SearchField
            label="搜索模板"
            hideLabel
            placeholder="搜索模板名称或格式"
            value={query}
            onValueChange={setQuery}
          />
        </div>
        <div className="flex gap-3">
          <Button loading={loading} variant="secondary" disabled={loading} onClick={onChanged}>
            <RefreshCw size={16} aria-hidden="true" />
            刷新模板
          </Button>
          {admin &&
            (templates ? (
              <DropdownMenu
                label="创建模板"
                icon={<Plus size={16} aria-hidden="true" />}
                items={templates
                  .filter((item) => item.builtin)
                  .map((item) => ({
                    label: `${item.format} 模板`,
                    onSelect: () => setEditing({ source: item, existing: false }),
                  }))}
              />
            ) : (
              <Button disabled>
                <Plus size={16} aria-hidden="true" />
                创建模板
              </Button>
            ))}
        </div>
      </div>
      <p className="text-sm text-(--text-secondary)">
        默认模板可直接编辑，也可复制后为不同客户端单独配置。
      </p>
      <DataTable
        caption="配置模板"
        loaded={templates !== null}
        loading={loading}
        emptyMessage={query ? '没有匹配的模板' : '暂无配置模板'}
        emptyState={{ variant: query ? 'no-results' : 'empty' }}
        rows={visible.map((item) => ({ ...item }))}
        rowKey="id"
        columns={[
          {
            key: 'name',
            label: '模板',
            render: (_, item) => (
              <div>
                <p className="break-all font-medium">{item.name}</p>
                <p className="mt-1 text-xs text-(--text-secondary)">
                  {item.builtin ? '系统默认' : '自定义模板'}
                </p>
              </div>
            ),
          },
          { key: 'format', label: '配置格式' },
          {
            key: 'replacements',
            label: '输出处理',
            sortable: false,
            render: (_, item) => (
              <div className="space-y-1 text-sm">
                <p>
                  {item.replacements.length
                    ? `${item.replacements.length} 条正则替换`
                    : '无正则替换'}
                </p>
                {item.script && <p className="text-xs text-(--text-secondary)">JavaScript</p>}
              </div>
            ),
          },
          {
            key: 'references',
            label: '应用规则',
            render: (_, item) => (
              <div className="max-w-64 break-words">
                <p>{item.references ? `${item.references} 条规则引用` : '尚未引用'}</p>
                {item.references > 0 && rules && (
                  <p className="mt-1 text-xs text-(--text-secondary)">
                    {rules
                      .filter((rule) => rule.template_id === item.id)
                      .map((rule) => rule.name)
                      .join('、')}
                  </p>
                )}
              </div>
            ),
          },
          {
            key: 'actions',
            label: '操作',
            sortable: false,
            render: (_, item) =>
              admin ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => setEditing({ source: item, existing: true })}
                  >
                    <Pencil size={16} aria-hidden="true" />
                    编辑
                  </Button>
                  <DropdownMenu
                    label="更多操作"
                    items={[
                      {
                        label: '版本历史',
                        icon: <History size={16} aria-hidden="true" />,
                        onSelect: () => setHistory(item),
                      },
                      {
                        label: '复制为新模板',
                        icon: <Copy size={16} aria-hidden="true" />,
                        onSelect: () => setEditing({ source: item, existing: false }),
                      },
                      {
                        label: item.builtin
                          ? '默认模板不可删除'
                          : item.references
                            ? '移除引用后可删除'
                            : '删除模板',
                        icon: <Trash2 size={16} aria-hidden="true" />,
                        disabled: item.builtin || item.references > 0,
                        destructive: true,
                        separatorBefore: true,
                        onSelect: () => setDeleting(item),
                      },
                    ]}
                  />
                </div>
              ) : (
                '只读'
              ),
          },
        ]}
      />
      {history && (
        <TemplateHistoryDialog
          source={history}
          session={session}
          onClose={() => setHistory(null)}
          onSaved={() => {
            setHistory(null);
            onChanged();
          }}
        />
      )}
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
          description={`将删除未被引用的模板“${deleting?.name ?? ''}”。`}
          footer={
            <>
              <Button variant="secondary" disabled={busy} onClick={() => setDeleting(null)}>
                取消
              </Button>
              <Button variant="danger" loading={busy} onClick={() => void remove()}>
                <Trash2 size={16} aria-hidden="true" />
                删除模板
              </Button>
            </>
          }
        />
      </Dialog>
    </div>
  );
}
