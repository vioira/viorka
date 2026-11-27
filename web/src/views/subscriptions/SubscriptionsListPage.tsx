import {
  AlertTriangle,
  ArrowRight,
  Ban,
  Eye,
  History,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  deleteSubscription,
  listSubscriptions,
  rotateSubscription,
  type SubscriptionItem,
} from '@/api/subscriptions';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { DropdownMenu } from '@/components/arc/dropdown-menu/dropdown-menu';
import { SearchField } from '@/components/arc/search-field/search-field';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import DataTable from '@/components/data-table';
import { resultLabel } from './components/access-result';
import SubscriptionDetailDrawer, {
  type SubscriptionDetailTab,
} from './components/SubscriptionDetailDrawer';
import { accessResultTone } from './components/service-meta';
import { useDialogFocus } from './components/useDialogFocus';
import { useSubscriptionPages } from './components/useSubscriptionPages';
import { useSubscriptionsContext } from './context';

type Action = { kind: 'rotate' | 'revoke' | 'delete'; item: SubscriptionItem };

export default function SubscriptionsListPage() {
  const {
    session,
    canManage,
    rules,
    templates,
    pendingRecoveryCount,
    recoveryCountLoaded,
    reloadRules,
    reloadTemplates,
    reloadRecoverySummary,
    openIssued,
  } = useSubscriptionsContext();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToastStack();
  const confirmationFocus = useDialogFocus();

  const initialStatus = searchParams.get('status');
  const filter =
    initialStatus === 'attention' || initialStatus === 'revoked' ? initialStatus : 'all';

  const [query, setQuery] = useState('');
  const [detailState, setDetailState] = useState<{
    id: string;
    tab: SubscriptionDetailTab;
  } | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);

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

  const rows = items ?? [];
  const activeDetailItem = useMemo(
    () => (detailState ? (rows.find((item) => item.id === detailState.id) ?? null) : null),
    [detailState, rows],
  );

  const enabledRulesCount = useMemo(
    () => (rules ? rules.filter((rule) => rule.enabled).length : null),
    [rules],
  );
  const activeSubsCount = useMemo(
    () => (items ? items.filter((item) => !item.revoked).length : null),
    [items],
  );
  const attentionServicesCount = useMemo(
    () =>
      items
        ? items.reduce(
            (sum, item) =>
              sum + item.services.filter((service) => service.status !== 'available').length,
            0,
          )
        : null,
    [items],
  );

  function setFilter(next: string) {
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        if (next === 'all') params.delete('status');
        else params.set('status', next);
        return params;
      },
      { replace: true },
    );
  }

  async function perform() {
    if (!action || busy) return;
    setBusy(true);
    try {
      if (action.kind === 'delete') {
        await deleteSubscription(action.item, session);
        if (detailState?.id === action.item.id) setDetailState(null);
        toast({ type: 'success', title: '订阅已删除' });
      } else {
        const result = await rotateSubscription(action.item, session, action.kind === 'revoke');
        if (action.kind === 'rotate') openIssued(result);
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

  return (
    <div className="min-w-0 space-y-5">
      {canManage && pendingRecoveryCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-(--radius-control) border-[1px] border-(--warning) bg-(--warning-muted) px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5 text-(length:--text-sm)">
            <AlertTriangle
              size={16}
              strokeWidth={1.75}
              className="shrink-0 text-(--warning)"
              aria-hidden="true"
            />
            <span>
              当前有 <span className="font-medium tabular-nums">{pendingRecoveryCount}</span>{' '}
              个托管引擎等待恢复核对或公网入口确认，相关服务暂不下发。
            </span>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void navigate('/subscriptions/recovery')}
          >
            前往恢复核对
            <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 divide-y divide-border-subtle rounded-(--radius-panel) border-[1px] border-border bg-surface lg:grid-cols-4 lg:divide-x lg:divide-y-0">
        <div className="px-5 py-3.5">
          <p className="text-(length:--text-xs) text-text-secondary">
            {cursor ? '已加载有效订阅' : '有效订阅'}
          </p>
          <p className="mt-1 text-(length:--text-lg) font-medium tabular-nums">
            {activeSubsCount === null ? '—' : activeSubsCount}
            {items !== null && (
              <span className="ml-1.5 text-(length:--text-xs) font-normal text-text-secondary">
                / {items.length}
              </span>
            )}
          </p>
        </div>
        <div className="px-5 py-3.5">
          <p className="text-(length:--text-xs) text-text-secondary">待处理服务</p>
          <p
            className={`mt-1 text-(length:--text-lg) font-medium tabular-nums ${
              attentionServicesCount ? 'text-(--danger)' : ''
            }`}
          >
            {attentionServicesCount === null ? '—' : attentionServicesCount}
          </p>
        </div>
        <div className="px-5 py-3.5">
          <p className="text-(length:--text-xs) text-text-secondary">已启用规则</p>
          <p className="mt-1 text-(length:--text-lg) font-medium tabular-nums">
            {enabledRulesCount === null ? '—' : enabledRulesCount}
          </p>
        </div>
        <div className="px-5 py-3.5">
          <p className="text-(length:--text-xs) text-text-secondary">恢复隔离引擎</p>
          <p
            className={`mt-1 text-(length:--text-lg) font-medium tabular-nums ${
              pendingRecoveryCount > 0
                ? 'text-(--warning)'
                : recoveryCountLoaded
                  ? 'text-(--success)'
                  : ''
            }`}
          >
            {!canManage
              ? '仅管理者可见'
              : !recoveryCountLoaded
                ? '—'
                : pendingRecoveryCount > 0
                  ? `${pendingRecoveryCount} 待处理`
                  : '全部就绪'}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
          <SegmentedControl
            label="订阅筛选"
            value={filter}
            onValueChange={setFilter}
            options={[
              { value: 'all', label: '全部' },
              { value: 'attention', label: '有异常服务' },
              { value: 'revoked', label: '已吊销' },
            ]}
          />
          <div className="min-w-0 flex-1 basis-56 max-w-xs">
            <SearchField
              label="搜索订阅"
              hideLabel
              placeholder="搜索订阅名称"
              value={query}
              onValueChange={setQuery}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            loading={loading}
            variant="secondary"
            disabled={loading}
            onClick={() => {
              void load();
              if (!rules) void reloadRules();
              if (!templates) void reloadTemplates();
              void reloadRecoverySummary();
            }}
          >
            <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />
            刷新
          </Button>
          {canManage && (
            <Button
              disabled={rules === null || templates === null || loading}
              onClick={() => void navigate('/subscriptions/new')}
            >
              <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
              创建订阅
            </Button>
          )}
        </div>
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
        onRowClick={(item) => setDetailState({ id: item.id, tab: 'services' })}
        columns={[
          {
            key: 'name',
            label: '订阅名称',
            render: (_, item) => (
              <div className="min-w-0">
                <p className="break-all font-medium">{item.name}</p>
                <p className="mt-1 text-(length:--text-xs) tabular-nums text-text-secondary">
                  {new Date(item.updated_at).toLocaleString()} 更新
                </p>
              </div>
            ),
          },
          {
            key: 'services',
            label: '服务健康',
            sortable: false,
            render: (_, item) => {
              const available = item.services.filter(
                (service) => service.status === 'available',
              ).length;
              const issues = item.services.length - available;
              return (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular-nums">
                    {available} / {item.services.length} 可用
                  </span>
                  {issues > 0 && (
                    <Badge tone="danger" size="sm" className="tabular-nums">
                      {issues} 异常
                    </Badge>
                  )}
                </div>
              );
            },
          },
          {
            key: 'rule_ids',
            label: '分发规则',
            sortable: false,
            render: (_, item) => {
              const names = item.rule_ids.map(
                (id) => rules?.find((rule) => rule.id === id)?.name ?? id,
              );
              return (
                <div className="flex flex-wrap gap-1.5" title={names.join('、')}>
                  {names.slice(0, 2).map((name) => (
                    <Badge key={name} tone="neutral" size="sm">
                      {name}
                    </Badge>
                  ))}
                  {names.length > 2 && (
                    <Badge tone="neutral" size="sm" className="tabular-nums">
                      +{names.length - 2}
                    </Badge>
                  )}
                </div>
              );
            },
          },
          {
            key: 'revoked',
            label: '凭证状态',
            render: (_, item) => (
              <Badge tone={item.revoked ? 'neutral' : 'success'} size="sm">
                {item.revoked ? '已吊销' : '已签发'}
              </Badge>
            ),
          },
          {
            key: 'last_access',
            label: '最近拉取',
            sortable: false,
            render: (_, item) => (
              <div className="space-y-1">
                {item.last_access ? (
                  <>
                    <button
                      type="button"
                      className="inline-flex cursor-pointer items-center border-0 bg-transparent p-0 text-left"
                      aria-label={`查看 ${item.name} 的访问记录`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setDetailState({ id: item.id, tab: 'access' });
                      }}
                    >
                      <Badge tone={accessResultTone(item.last_access.result)} size="sm">
                        {resultLabel(item.last_access.result)}
                      </Badge>
                    </button>
                    <p className="text-(length:--text-xs) tabular-nums text-text-secondary">
                      {new Date(item.last_access.at).toLocaleString()}
                    </p>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`查看 ${item.name} 的访问记录`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setDetailState({ id: item.id, tab: 'access' });
                    }}
                  >
                    暂无记录
                  </Button>
                )}
              </div>
            ),
          },
          {
            key: 'actions',
            label: '操作',
            sortable: false,
            render: (_, item) => (
              <div
                className="flex flex-wrap items-center gap-2"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDetailState({ id: item.id, tab: 'services' })}
                >
                  <Eye size={15} strokeWidth={1.75} aria-hidden="true" />
                  详情
                </Button>
                {canManage && (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={rules === null || templates === null}
                      onClick={() =>
                        void navigate(`/subscriptions/${item.id}/edit`, {
                          state: { initialSubscription: item },
                        })
                      }
                    >
                      <Pencil size={15} strokeWidth={1.75} aria-hidden="true" />
                      编辑
                    </Button>
                    <DropdownMenu
                      label="更多操作"
                      items={[
                        {
                          label: '访问记录',
                          icon: <History size={16} strokeWidth={1.75} aria-hidden="true" />,
                          onSelect: () => setDetailState({ id: item.id, tab: 'access' }),
                        },
                        {
                          label: item.revoked ? '签发新链接' : '轮换订阅链接',
                          icon: <KeyRound size={16} strokeWidth={1.75} aria-hidden="true" />,
                          onSelect: () => setAction({ kind: 'rotate', item }),
                        },
                        {
                          label: '吊销订阅链接',
                          icon: <Ban size={16} strokeWidth={1.75} aria-hidden="true" />,
                          disabled: item.revoked,
                          destructive: true,
                          separatorBefore: true,
                          onSelect: () => setAction({ kind: 'revoke', item }),
                        },
                        {
                          label: '删除订阅',
                          icon: <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />,
                          destructive: true,
                          onSelect: () => setAction({ kind: 'delete', item }),
                        },
                      ]}
                    />
                  </>
                )}
              </div>
            ),
          },
        ]}
      />

      {cursor && (
        <div className="flex justify-center border-t-[1px] border-border-subtle pt-4">
          <Button variant="secondary" disabled={loading} onClick={() => void load(cursor)}>
            加载更多订阅
          </Button>
        </div>
      )}

      <SubscriptionDetailDrawer
        item={activeDetailItem}
        initialTab={detailState?.tab ?? 'services'}
        rules={rules}
        session={session}
        canManage={canManage}
        onClose={() => setDetailState(null)}
        onEdit={(item) => {
          setDetailState(null);
          void navigate(`/subscriptions/${item.id}/edit`, {
            state: { initialSubscription: item },
          });
        }}
        onRotate={(item) => setAction({ kind: 'rotate', item })}
        onAccessCleared={() => void load()}
      />

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
                  <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
                ) : action?.kind === 'revoke' ? (
                  <Ban size={16} strokeWidth={1.75} aria-hidden="true" />
                ) : (
                  <KeyRound size={16} strokeWidth={1.75} aria-hidden="true" />
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
