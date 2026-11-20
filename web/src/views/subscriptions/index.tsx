import { Ban, History, KeyRound, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router';
import type { Session } from '@/api/auth';
import {
  deleteSubscription,
  listSubscriptionRules,
  listSubscriptions,
  listSubscriptionTemplates,
  rotateSubscription,
  type SubscriptionIssued,
  type SubscriptionItem,
  type SubscriptionRule,
  type SubscriptionTemplate,
} from '@/api/subscriptions';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { DropdownMenu } from '@/components/arc/dropdown-menu/dropdown-menu';
import { SearchField } from '@/components/arc/search-field/search-field';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/arc/tabs/tabs';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import DataTable from '@/components/data-table';
import AccessDialog from './components/AccessDialog';
import { resultLabel } from './components/access-result';
import IssuedDialog from './components/IssuedDialog';
import RecoveryPanel from './components/RecoveryPanel';
import RulesPanel from './components/RulesPanel';
import SubscriptionEditor from './components/SubscriptionEditor';
import TemplatesPanel from './components/TemplatesPanel';
import { useDialogFocus } from './components/useDialogFocus';
import { useSubscriptionPages } from './components/useSubscriptionPages';

type Action = { kind: 'rotate' | 'revoke' | 'delete'; item: SubscriptionItem };

export default function SubscriptionsPage() {
  const session = useOutletContext<Session>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const { toast } = useToastStack();
  const confirmationFocus = useDialogFocus();
  const search = query.trim();
  const request = useCallback(
    (after: string, signal: AbortSignal) => listSubscriptions(after, search, filter, signal),
    [search, filter],
  );
  const { items, cursor, loading, load } = useSubscriptionPages(
    JSON.stringify([search, filter]),
    request,
    'subscriptions-load',
    '未能读取订阅',
  );
  const [rules, setRules] = useState<SubscriptionRule[] | null>(null);
  const [templates, setTemplates] = useState<SubscriptionTemplate[] | null>(null);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const templatesAbort = useRef<AbortController | null>(null);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [editing, setEditing] = useState<SubscriptionItem | null | undefined>();
  const [issued, setIssued] = useState<SubscriptionIssued | null>(null);
  const [access, setAccess] = useState<SubscriptionItem | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const rulesAbort = useRef<AbortController | null>(null);
  const createFocus = useRef<HTMLButtonElement | null>(null);
  const issuedFocus = useRef<HTMLElement | null>(null);
  const canManage = session.user.role === 'admin' || session.user.role === 'operator';

  const loadRules = useCallback(async () => {
    rulesAbort.current?.abort();
    const controller = new AbortController();
    rulesAbort.current = controller;
    setRulesLoading(true);
    try {
      const result = await listSubscriptionRules(controller.signal);
      if (!controller.signal.aborted) setRules(result.items);
    } catch (error) {
      if (!controller.signal.aborted)
        toast({
          id: 'subscription-rules-load',
          type: 'error',
          title: '未能读取应用规则',
          description: error instanceof Error ? error.message : '请刷新规则重试。',
        });
    } finally {
      if (!controller.signal.aborted) setRulesLoading(false);
    }
  }, [toast]);
  const loadTemplates = useCallback(async () => {
    templatesAbort.current?.abort();
    const controller = new AbortController();
    templatesAbort.current = controller;
    setTemplatesLoading(true);
    try {
      const result = await listSubscriptionTemplates(controller.signal);
      if (!controller.signal.aborted) setTemplates(result.items);
    } catch (error) {
      if (!controller.signal.aborted)
        toast({
          id: 'subscription-templates-load',
          type: 'error',
          title: '未能读取配置模板',
          description: error instanceof Error ? error.message : '请刷新模板重试。',
        });
    } finally {
      if (!controller.signal.aborted) setTemplatesLoading(false);
    }
  }, [toast]);
  useEffect(() => {
    void loadRules();
    void loadTemplates();
    return () => {
      rulesAbort.current?.abort();
      templatesAbort.current?.abort();
    };
  }, [loadRules, loadTemplates]);

  async function perform() {
    if (!action || busy) return;
    setBusy(true);
    try {
      if (action.kind === 'delete') {
        await deleteSubscription(action.item, session);
        toast({ type: 'success', title: '订阅已删除' });
      } else {
        const result = await rotateSubscription(action.item, session, action.kind === 'revoke');
        if (action.kind === 'rotate') setIssued(result);
        else toast({ type: 'success', title: '订阅链接已吊销' });
      }
      setAction(null);
      await load();
    } catch (error) {
      toast({
        id: `subscription-${action.kind}`,
        type: 'error',
        title: '未能完成订阅操作',
        description: error instanceof Error ? error.message : '请刷新后重试。',
      });
    } finally {
      setBusy(false);
    }
  }
  const actionTitle =
    action?.kind === 'delete'
      ? '删除订阅？'
      : action?.kind === 'revoke'
        ? '吊销订阅链接？'
        : action?.item.revoked
          ? '签发订阅链接？'
          : '轮换订阅链接？';
  const actionDescription =
    action?.kind === 'delete'
      ? `将删除“${action.item.name}”并使链接失效。已下载的节点配置仍可能使用。`
      : action?.kind === 'revoke'
        ? `“${action.item.name}”的链接将立即失效。已下载的节点配置仍可能使用。`
        : action?.item.revoked
          ? `将为“${action.item.name}”签发新链接。完整链接仅显示一次。`
          : `“${action?.item.name ?? ''}”的旧链接将立即失效，客户端需要更新链接。`;

  const requestedView = searchParams.get('view') ?? 'subscriptions';
  const view = ['subscriptions', 'rules', 'templates', ...(canManage ? ['recovery'] : [])].includes(
    requestedView,
  )
    ? requestedView
    : 'subscriptions';
  const rows = items ?? [];
  if (editing !== undefined && rules && templates)
    return (
      <div data-subscription-management>
        <SubscriptionEditor
          item={editing}
          rules={rules}
          templates={templates}
          session={session}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            void load();
          }}
          onIssued={(result) => {
            setEditing(undefined);
            setIssued(result);
            void load();
          }}
        />
      </div>
    );
  return (
    <div data-subscription-management className="min-w-0 space-y-6">
      <Tabs
        value={view}
        onValueChange={(next) =>
          setSearchParams((previous) => {
            const params = new URLSearchParams(previous);
            if (next === 'subscriptions') params.delete('view');
            else params.set('view', next);
            return params;
          })
        }
      >
        <TabsList aria-label="订阅管理">
          <TabsTrigger value="subscriptions">订阅</TabsTrigger>
          <TabsTrigger value="rules">应用规则</TabsTrigger>
          <TabsTrigger value="templates">配置模板</TabsTrigger>
          {canManage && <TabsTrigger value="recovery">恢复核对</TabsTrigger>}
        </TabsList>
        <TabsContent value="subscriptions" forceMount className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0 flex-1 basis-64 max-w-md">
              <SearchField
                label="搜索订阅"
                hideLabel
                placeholder="搜索订阅名称"
                value={query}
                onValueChange={setQuery}
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                loading={loading}
                variant="secondary"
                disabled={loading}
                onClick={() => {
                  void load();
                  if (!rules) void loadRules();
                  if (!templates) void loadTemplates();
                }}
              >
                <RefreshCw size={16} aria-hidden="true" />
                刷新订阅
              </Button>
              {canManage && (
                <Button
                  ref={createFocus}
                  disabled={rules === null || templates === null || loading}
                  onClick={(event) => {
                    issuedFocus.current = event.currentTarget;
                    setEditing(null);
                  }}
                >
                  <Plus size={16} aria-hidden="true" />
                  创建订阅
                </Button>
              )}
            </div>
          </div>
          <div className="flex flex-wrap">
            <SegmentedControl
              label="订阅筛选"
              value={filter}
              onValueChange={setFilter}
              options={[
                { value: 'all', label: '全部' },
                { value: 'attention', label: '有不可用服务' },
                { value: 'revoked', label: '已吊销' },
              ]}
            />
          </div>
          <DataTable
            caption="订阅列表"
            minWidth={832}
            loaded={items !== null}
            loading={loading}
            emptyMessage={query || filter !== 'all' ? '没有匹配的订阅' : '尚未创建订阅'}
            emptyState={{
              variant: query || filter !== 'all' ? 'no-results' : 'empty',
              description:
                query || filter !== 'all'
                  ? '请调整搜索词或筛选条件。'
                  : '选择服务与客户端规则，生成可更新的配置链接。',
            }}
            rows={rows.map((item) => ({ ...item }))}
            rowKey="id"
            columns={[
              {
                key: 'name',
                label: '订阅',
                render: (_, item) => (
                  <div className="min-w-0">
                    <p className="break-all font-medium">{item.name}</p>
                    <p className="mt-1 text-xs text-(--text-secondary)">
                      {new Date(item.updated_at).toLocaleString()} 更新
                    </p>
                  </div>
                ),
              },
              {
                key: 'services',
                label: '服务',
                sortable: false,
                render: (_, item) => {
                  const available = item.services.filter(
                    (service) => service.status === 'available',
                  ).length;
                  return (
                    <div className="space-y-1">
                      <p className="tabular-nums">
                        {available} / {item.services.length} 可用
                      </p>
                      {available < item.services.length && (
                        <p className="text-xs text-(--danger)">
                          {item.services.length - available} 个需处理
                        </p>
                      )}
                    </div>
                  );
                },
              },
              {
                key: 'rule_ids',
                label: '客户端规则',
                sortable: false,
                render: (_, item) => (
                  <span className="break-words">
                    {item.rule_ids
                      .map((id) => rules?.find((rule) => rule.id === id)?.name ?? id)
                      .join('、')}
                  </span>
                ),
              },
              {
                key: 'revoked',
                label: '链接',
                render: (_, item) => (
                  <span className={item.revoked ? 'text-(--text-secondary)' : ''}>
                    {item.revoked ? '已吊销' : '已签发'}
                  </span>
                ),
              },
              {
                key: 'last_access',
                label: '最近拉取',
                sortable: false,
                render: (_, item) => (
                  <div className="space-y-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`查看 ${item.name} 的访问记录`}
                      onClick={() => setAccess(item)}
                    >
                      {item.last_access ? resultLabel(item.last_access.result) : '暂无记录'}
                    </Button>
                    {item.last_access && (
                      <p className="text-xs tabular-nums text-(--text-secondary)">
                        {new Date(item.last_access.at).toLocaleString()}
                      </p>
                    )}
                  </div>
                ),
              },
              {
                key: 'actions',
                label: '操作',
                sortable: false,
                render: (_, item) => (
                  <div className="flex flex-wrap items-center gap-2">
                    {canManage ? (
                      <Button
                        variant="secondary"
                        disabled={rules === null || templates === null}
                        onClick={() => setEditing(item)}
                      >
                        <Pencil size={16} aria-hidden="true" />
                        编辑订阅
                      </Button>
                    ) : (
                      <Button variant="secondary" onClick={() => setAccess(item)}>
                        <History size={16} aria-hidden="true" />
                        记录
                      </Button>
                    )}
                    {canManage && (
                      <DropdownMenu
                        label="更多操作"
                        items={[
                          {
                            label: '访问记录',
                            icon: <History size={16} aria-hidden="true" />,
                            onSelect: () => setAccess(item),
                          },
                          {
                            label: item.revoked ? '签发新链接' : '轮换订阅链接',
                            icon: <KeyRound size={16} aria-hidden="true" />,
                            onSelect: () => setAction({ kind: 'rotate', item }),
                          },
                          {
                            label: '吊销订阅链接',
                            icon: <Ban size={16} aria-hidden="true" />,
                            disabled: item.revoked,
                            destructive: true,
                            separatorBefore: true,
                            onSelect: () => setAction({ kind: 'revoke', item }),
                          },
                          {
                            label: '删除订阅',
                            icon: <Trash2 size={16} aria-hidden="true" />,
                            destructive: true,
                            onSelect: () => setAction({ kind: 'delete', item }),
                          },
                        ]}
                      />
                    )}
                  </div>
                ),
              },
            ]}
          />
          {cursor && (
            <div className="flex justify-center border-t border-(--border-subtle) pt-4">
              <Button variant="secondary" disabled={loading} onClick={() => void load(cursor)}>
                加载更多订阅
              </Button>
            </div>
          )}
        </TabsContent>
        <TabsContent value="rules" forceMount>
          <RulesPanel
            rules={rules ?? []}
            templates={templates}
            loaded={rules !== null}
            loading={rulesLoading}
            session={session}
            onChanged={() => {
              void loadRules();
              void loadTemplates();
              void load();
            }}
          />
        </TabsContent>
        <TabsContent value="templates" forceMount>
          <TemplatesPanel
            templates={templates}
            rules={rules}
            loading={templatesLoading}
            session={session}
            onChanged={() => {
              void loadTemplates();
              void loadRules();
            }}
          />
        </TabsContent>
        {canManage && (
          <TabsContent value="recovery">
            <RecoveryPanel session={session} onChanged={() => void load()} />
          </TabsContent>
        )}
      </Tabs>
      {access && (
        <AccessDialog
          item={access}
          rules={rules}
          session={session}
          onClose={() => setAccess(null)}
          onCleared={() => void load()}
        />
      )}
      {issued && (
        <IssuedDialog
          issued={issued}
          onClose={() => setIssued(null)}
          returnFocus={() =>
            issuedFocus.current?.isConnected ? issuedFocus.current : createFocus.current
          }
        />
      )}
      <Dialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setAction(null);
        }}
      >
        <DialogContent
          {...confirmationFocus}
          data-subscription-management
          title={actionTitle}
          description={actionDescription}
          footer={
            <>
              <Button variant="secondary" disabled={busy} onClick={() => setAction(null)}>
                取消
              </Button>
              <Button
                variant={action?.kind === 'rotate' ? 'primary' : 'danger'}
                loading={busy}
                onClick={() => void perform()}
              >
                {action?.kind === 'delete' ? (
                  <Trash2 size={16} aria-hidden="true" />
                ) : action?.kind === 'revoke' ? (
                  <Ban size={16} aria-hidden="true" />
                ) : (
                  <KeyRound size={16} aria-hidden="true" />
                )}
                {action?.kind === 'delete'
                  ? '删除订阅'
                  : action?.kind === 'revoke'
                    ? '吊销链接'
                    : action?.item.revoked
                      ? '签发链接'
                      : '轮换链接'}
              </Button>
            </>
          }
        />
      </Dialog>
    </div>
  );
}
