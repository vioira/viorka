import {
  AlertTriangle,
  ArrowRight,
  Ban,
  ChevronRight,
  Eye,
  History,
  KeyRound,
  ListFilter,
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
import { CardGridSkeleton, shouldHandleCardClick } from '@/components/card-kit';
import EmptyStates from '@/components/empty-states';
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

  const hasFilter = Boolean(query) || filter !== 'all';

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

      <div className="grid grid-cols-2 divide-y-[1px] divide-border-subtle overflow-hidden rounded-(--radius-panel) border-[1px] border-border bg-surface lg:grid-cols-4 lg:divide-x-[1px] lg:divide-y-0">
        <div className="px-5 py-3.5">
          <p className="text-(length:--text-xs) text-text-secondary">
            {cursor ? '已加载有效订阅' : '有效订阅'}
          </p>
          <p className="mt-1 text-(length:--text-lg) font-medium tabular-nums">
            {activeSubsCount === null ? '-' : activeSubsCount}
            {items !== null && (
              <span className="ml-1.5 text-(length:--text-xs) font-normal text-text-secondary">
                / {items.length}
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          aria-pressed={filter === 'attention'}
          onClick={() => setFilter(filter === 'attention' ? 'all' : 'attention')}
          className={`px-5 py-3.5 text-left transition-colors ${
            filter === 'attention' ? 'bg-(--accent-subtle)' : 'hover:bg-surface-muted/50'
          }`}
        >
          <p
            className={`text-(length:--text-xs) ${
              filter === 'attention' ? 'font-medium text-foreground' : 'text-text-secondary'
            }`}
          >
            待处理服务（点击筛选）
          </p>
          <p
            className={`mt-1 text-(length:--text-lg) font-medium tabular-nums ${
              attentionServicesCount ? 'text-(--danger)' : ''
            }`}
          >
            {attentionServicesCount === null ? '-' : attentionServicesCount}
          </p>
        </button>
        <div className="px-5 py-3.5">
          <p className="text-(length:--text-xs) text-text-secondary">已启用规则</p>
          <p className="mt-1 text-(length:--text-lg) font-medium tabular-nums">
            {enabledRulesCount === null ? '-' : enabledRulesCount}
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
                ? '-'
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
          <div className="min-w-40 max-w-xs flex-1 basis-52">
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

      <section aria-label="订阅列表" className="min-w-0 space-y-4">
        {items === null && loading ? (
          <CardGridSkeleton count={6} cols="3col" label="正在读取订阅列表" />
        ) : items === null ? (
          <div className="v-card">
            <EmptyStates headingLevel={3} compact variant="unknown" title="订阅尚未读取" />
          </div>
        ) : rows.length === 0 ? (
          <div className="v-card">
            <EmptyStates
              headingLevel={3}
              compact
              variant={hasFilter ? 'no-results' : 'empty'}
              title={hasFilter ? '没有匹配的订阅' : '尚未创建订阅'}
              description={
                hasFilter
                  ? '请调整搜索词或筛选条件。'
                  : '选择服务与客户端规则，生成可更新的配置链接。'
              }
              action={
                hasFilter ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setQuery('');
                      setFilter('all');
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
            {rows.map((item) => {
              const available = item.services.filter(
                (service) => service.status === 'available',
              ).length;
              const total = item.services.length;
              const issues = total - available;
              const pct = total ? Math.round((available / total) * 100) : 0;
              const ruleNames = item.rule_ids.map(
                (id) => rules?.find((rule) => rule.id === id)?.name ?? id,
              );

              return (
                <article
                  key={item.id}
                  data-card="subscription"
                  onClick={(event) => {
                    if (shouldHandleCardClick(event)) {
                      setDetailState({ id: item.id, tab: 'services' });
                    }
                  }}
                  className="flex min-w-0 cursor-pointer flex-col justify-between space-y-3 rounded-(--radius-surface) border-[1px] border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-surface-muted/30"
                >
                  <div className="space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          data-card-interactive="1"
                          onClick={() => setDetailState({ id: item.id, tab: 'services' })}
                          className="text-left text-(length:--text-sm) font-medium text-foreground hover:text-accent hover:underline wrap-anywhere"
                        >
                          {item.name}
                        </button>
                        <p className="mt-0.5 text-(length:--text-xs) text-text-secondary tabular-nums">
                          {new Date(item.updated_at).toLocaleString()} 更新
                        </p>
                      </div>
                      <Badge
                        size="sm"
                        tone={item.revoked ? 'neutral' : 'success'}
                        className="shrink-0"
                      >
                        {item.revoked ? '已吊销' : '已签发'}
                      </Badge>
                    </div>

                    {/* Service Health Progress */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2 text-(length:--text-xs)">
                        <span className="text-text-secondary">服务健康</span>
                        <div className="flex items-center gap-1.5 tabular-nums">
                          <span className="font-medium text-foreground">
                            {available} / {total} 可用
                          </span>
                          {issues > 0 && (
                            <Badge size="sm" tone="danger" className="tabular-nums">
                              {issues} 异常
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div
                        role="progressbar"
                        aria-label={`${item.name} 服务可用占比`}
                        aria-valuenow={pct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        className="h-1.5 w-full overflow-hidden rounded-full bg-(--usage-track)"
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: issues > 0 ? 'var(--warning)' : 'var(--success)',
                          }}
                        />
                      </div>
                    </div>

                    {/* Bound Rules */}
                    {ruleNames.length > 0 && (
                      <div
                        className="flex flex-wrap items-center gap-1.5"
                        title={ruleNames.join('、')}
                      >
                        {ruleNames.slice(0, 2).map((name) => (
                          <Badge key={name} size="sm" tone="neutral">
                            {name}
                          </Badge>
                        ))}
                        {ruleNames.length > 2 && (
                          <Badge size="sm" tone="neutral" className="tabular-nums">
                            +{ruleNames.length - 2}
                          </Badge>
                        )}
                      </div>
                    )}

                    {/* Explicit Recent Access Strip */}
                    <button
                      type="button"
                      data-card-interactive="1"
                      aria-label={`查看 ${item.name} 的访问记录`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setDetailState({ id: item.id, tab: 'access' });
                      }}
                      className="flex w-full items-center justify-between gap-2 rounded-(--radius-control) border-[1px] border-border-subtle bg-surface-muted/50 px-3 py-2 text-left text-(length:--text-xs) transition-colors hover:border-border-strong"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0 text-text-secondary">最近拉取</span>
                        {item.last_access ? (
                          <>
                            <Badge size="sm" tone={accessResultTone(item.last_access.result)}>
                              {resultLabel(item.last_access.result)}
                            </Badge>
                            <span className="truncate text-text-secondary tabular-nums">
                              {new Date(item.last_access.at).toLocaleString()}
                            </span>
                          </>
                        ) : (
                          <span className="text-text-secondary">暂无记录</span>
                        )}
                      </div>
                      <span className="inline-flex shrink-0 items-center gap-0.5 font-medium text-accent">
                        记录
                        <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" />
                      </span>
                    </button>
                  </div>

                  {/* Contextual Footer */}
                  <div className="flex items-center justify-between gap-2 border-t-[1px] border-border-subtle pt-2.5">
                    {canManage ? (
                      item.revoked ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          data-card-interactive="1"
                          onClick={() => setAction({ kind: 'rotate', item })}
                        >
                          <KeyRound
                            size={14}
                            strokeWidth={1.75}
                            className="text-accent"
                            aria-hidden="true"
                          />
                          签发新链接
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          data-card-interactive="1"
                          disabled={rules === null || templates === null}
                          onClick={() =>
                            void navigate(`/subscriptions/${item.id}/edit`, {
                              state: { initialSubscription: item },
                            })
                          }
                        >
                          <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
                          编辑
                        </Button>
                      )
                    ) : (
                      <span className="text-(length:--text-xs) text-text-secondary">只读</span>
                    )}

                    <div className="flex items-center gap-1" data-card-interactive="1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDetailState({ id: item.id, tab: 'services' })}
                      >
                        <Eye size={14} strokeWidth={1.75} aria-hidden="true" />
                        详情
                      </Button>
                      {canManage && (
                        <DropdownMenu
                          label="更多操作"
                          items={[
                            ...(item.revoked
                              ? [
                                  {
                                    label: '编辑订阅',
                                    icon: (
                                      <Pencil size={16} strokeWidth={1.75} aria-hidden="true" />
                                    ),
                                    disabled: rules === null || templates === null,
                                    onSelect: () =>
                                      void navigate(`/subscriptions/${item.id}/edit`, {
                                        state: { initialSubscription: item },
                                      }),
                                  },
                                ]
                              : []),
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
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

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
