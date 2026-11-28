import {
  AlertTriangle,
  ArrowUpRight,
  ChevronRight,
  Eye,
  Link2,
  ListFilter,
  Plus,
  RefreshCw,
  Waypoints,
} from 'lucide-react';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router';
import type { Session } from '@/api/auth';
import { ApiError } from '@/api/client';
import {
  type Connection,
  engineConnections,
  engineNames,
  engineSyncError,
  retryEngineSync,
} from '@/api/engines';
import { listProxyServices } from '@/api/proxy-services';
import type { RelayRoute } from '@/api/relays';
import { Badge, type BadgeTone } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { Drawer, DrawerContent, DrawerTrigger } from '@/components/arc/drawer/drawer';
import { SearchField } from '@/components/arc/search-field/search-field';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { Select } from '@/components/arc/select/select';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import {
  CardGridSkeleton,
  EndpointCopyButton,
  type LensItem,
  LensStrip,
  shouldHandleCardClick,
} from '@/components/card-kit';
import EmptyStates from '@/components/empty-states';
import EngineConnectionsDialog from '@/components/engine-connections';
import { NodeStatusLink } from '@/components/node-status';
import Pagination from '@/components/pagination';
import {
  needsRelayPublication,
  nodeEnginePath,
  summarizeServiceRelays,
} from '@/components/proxy/relay-meta';
import { cursorForPage, firstCursor } from '@/hooks/cursor-page';
import { useRealtimeConnection, useServerEvent } from '@/hooks/realtime';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import RelayDraftDrawer from '@/views/relay-routes/components/RelayDraftDrawer';
import RelayPublishDialog from '@/views/relay-routes/components/RelayPublishDialog';
import AddServiceDialog from './components/AddServiceDialog';
import ServiceInspectorDrawer from './components/ServiceInspectorDrawer';
import { type ServiceRow, serviceRow } from './service-data';

type StatusLens = 'all' | 'running' | 'pending' | 'attention';
type RelayFilter = 'all' | 'relayed' | 'direct';

function runtimeBadgeTone(runtime: string): BadgeTone {
  if (runtime === '运行中') return 'success';
  if (runtime === '异常') return 'danger';
  if (runtime === '未发布') return 'warning';
  return 'neutral';
}

export default function ProxyServicesPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const session = useOutletContext<Session>();
  const { toast } = useToastStack();
  const canManage = session.user.role !== 'viewer';

  const [data, setData] = useState<Awaited<ReturnType<typeof listProxyServices>> | null>(null);
  const [cursor, setCursor] = useState(firstCursor);
  const [shownCursor, setShownCursor] = useState(firstCursor);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [, report] = useToastFeedback('error');

  const [lens, setLens] = useState<StatusLens>('all');
  const [query, setQuery] = useState('');
  const [node, setNode] = useState('all');
  const [engine, setEngine] = useState('all');
  const [relayFilter, setRelayFilter] = useState<RelayFilter>('all');
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);

  const [search, setSearch] = useState('');
  useEffect(() => {
    const value = query.trim();
    if (value === search) return;
    const timer = setTimeout(() => {
      setSearch(value);
      setCursor(firstCursor);
    }, 200);
    return () => clearTimeout(timer);
  }, [query, search]);

  const selectedId = params.get('service');
  const rows = useMemo(() => data?.items.map(serviceRow) ?? [], [data]);
  const selected =
    rows.find((row) => row.id === selectedId) ??
    (data?.selected && data.selected.id === selectedId ? serviceRow(data.selected) : null);
  const previousId = useRef(selectedId);
  const loadMissingSelection = useEffectEvent(() => {
    if (selectedId && !selected) setReload((value) => value + 1);
  });
  useEffect(() => {
    if (previousId.current !== selectedId) loadMissingSelection();
    previousId.current = selectedId;
  }, [selectedId]);
  const requestedSelection = useEffectEvent(() =>
    selectedId && /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,64}$/.test(selectedId)
      ? selectedId
      : undefined,
  );
  const { connected } = useRealtimeConnection();
  const awaitingInitialReady = useRef(!connected);
  const [adding, setAdding] = useState(false);
  const [relayDraftTarget, setRelayDraftTarget] = useState<ServiceRow | null>(null);
  const [relayReview, setRelayReview] = useState<RelayRoute | null>(null);
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [connectionNode, setConnectionNode] = useState('');
  const [connectionRelays, setConnectionRelays] = useState<RelayRoute[]>([]);
  const [revealing, setRevealing] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const focusRef = useRef<HTMLElement | null>(null);
  const connectionFocus = useRef<HTMLElement | null>(null);
  const connectionRequest = useRef(0);

  useEffect(
    () => () => {
      connectionRequest.current++;
    },
    [],
  );

  useEffect(() => {
    void reload;
    const controller = new AbortController();
    setLoading(true);
    report('');
    listProxyServices(
      {
        after: cursor.after || undefined,
        selected: requestedSelection(),
        q: search || undefined,
        status: lens === 'all' ? undefined : lens,
        node: node === 'all' ? undefined : node,
        engine: engine === 'all' ? undefined : engine,
        access: relayFilter === 'all' ? undefined : relayFilter,
      },
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result);
          setShownCursor(cursor);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          if (error instanceof ApiError && (error.status === 401 || error.status === 403))
            setData(null);
          awaitingInitialReady.current = false;
          report(error instanceof Error ? error.message : '无法读取代理服务，请刷新重试');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reload, report, cursor, search, lens, node, engine, relayFilter]);

  useServerEvent(
    (event) => {
      // BrowserSocket sends queued reads after the initial subscription is ready.
      if (event.type === 'ready' && awaitingInitialReady.current) {
        awaitingInitialReady.current = false;
        return;
      }
      if (
        event.type === 'ready' ||
        (event.type === 'change' && ['engines', 'recovery'].includes(event.change.kind))
      ) {
        setReload((v) => v + 1);
      }
    },
    [
      { kind: 'engines', all: true },
      { kind: 'recovery', all: true },
    ],
  );

  const counts = data?.counts ?? { all: 0, running: 0, pending: 0, attention: 0 };

  async function reveal(row: ServiceRow) {
    const request = ++connectionRequest.current;
    connectionFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setRevealing(true);
    report('');
    try {
      const result = await engineConnections(row.engine.id, session);
      if (request !== connectionRequest.current) return;
      setConnectionNode(row.node.id);
      setConnectionRelays(row.relays);
      setConnections(result.filter((item) => item.service_id === row.service.id));
    } catch (error) {
      if (request === connectionRequest.current)
        report(error instanceof Error ? error.message : '无法读取连接信息，请刷新重试');
    } finally {
      if (request === connectionRequest.current) setRevealing(false);
    }
  }

  async function retrySync(row: ServiceRow) {
    if (retrying) return;
    setRetrying(true);
    try {
      await retryEngineSync(row.engine.id, session);
      toast({
        id: `engine-sync-${row.engine.id}`,
        type: 'success',
        title: '已提交重试同步请求',
        description: `节点 ${row.node.name} 的 ${row.engine.name} 将重新应用目标配置。`,
      });
      setReload((value) => value + 1);
    } catch (error) {
      toast({
        id: `engine-sync-${row.engine.id}`,
        type: 'error',
        title: '未能提交重试同步',
        description: error instanceof Error ? error.message : '请核对节点状态后重试。',
      });
    } finally {
      setRetrying(false);
    }
  }

  function openInspector(row: ServiceRow) {
    focusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const next = new URLSearchParams(params);
    next.set('service', row.id);
    setParams(next);
  }

  function closeInspector() {
    const next = new URLSearchParams(params);
    next.delete('service');
    setParams(next, { replace: true });
  }

  function startAddRelay(row: ServiceRow) {
    focusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setRelayDraftTarget(row);
  }

  function resetFilters() {
    setLens('all');
    setQuery('');
    setSearch('');
    setCursor(firstCursor);
    setNode('all');
    setEngine('all');
    setRelayFilter('all');
  }

  const hasActiveFilter =
    lens !== 'all' || Boolean(query) || node !== 'all' || engine !== 'all' || relayFilter !== 'all';
  const mobileFilterCount =
    (node !== 'all' ? 1 : 0) + (engine !== 'all' ? 1 : 0) + (relayFilter !== 'all' ? 1 : 0);

  const lenses: LensItem<StatusLens>[] = [
    { key: 'all', label: '全部服务', count: counts.all },
    { key: 'running', label: '运行中', count: counts.running, dotClass: 'bg-success' },
    {
      key: 'pending',
      label: '待同步或未发布',
      count: counts.pending,
      dotClass: counts.pending > 0 ? 'bg-warning' : undefined,
    },
    {
      key: 'attention',
      label: '需关注',
      count: counts.attention,
      dotClass: counts.attention > 0 ? 'bg-danger' : undefined,
    },
  ];

  const manageableNodes = useMemo(
    () => data?.nodes.filter((item) => item.can_manage) ?? [],
    [data],
  );
  const nodeOptions = [
    { value: 'all', label: '全部节点' },
    ...(data?.nodes ?? []).map((item) => ({ value: item.id, label: item.name })),
  ];
  const accessOptions = [
    { value: 'all', label: '全部接入' },
    { value: 'relayed', label: '已关联中转' },
    { value: 'direct', label: '仅直连' },
  ];
  const engineOptions = [
    { value: 'all', label: '全部引擎' },
    ...engineNames.map((value) => ({ value, label: value })),
  ];

  return (
    <>
      <LensStrip
        items={lenses}
        activeKey={lens}
        loaded={data !== null}
        label="按运行与同步状态筛选服务"
        onChange={(nextLens) => {
          setLens(nextLens);
          setCursor(firstCursor);
        }}
      />

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="min-w-44 flex-1 sm:max-w-72">
            <SearchField
              hideLabel
              label="搜索服务"
              placeholder="服务名、节点、端口或关联中转"
              value={query}
              onValueChange={setQuery}
            />
          </div>

          <div className="hidden flex-wrap items-center gap-2.5 sm:flex">
            <div className="w-40">
              <Select
                hideLabel
                label="节点"
                value={node}
                onValueChange={(value) => {
                  setNode(value);
                  setCursor(firstCursor);
                }}
                options={nodeOptions}
              />
            </div>
            <div className="w-36">
              <Select
                hideLabel
                label="接入方式"
                value={relayFilter}
                onValueChange={(value) => {
                  setRelayFilter(value as RelayFilter);
                  setCursor(firstCursor);
                }}
                options={accessOptions}
              />
            </div>
            <SegmentedControl
              label="按引擎筛选"
              value={engine}
              onValueChange={(value) => {
                setEngine(value);
                setCursor(firstCursor);
              }}
              options={engineOptions}
            />
          </div>

          <div className="sm:hidden">
            <Drawer open={mobileFilterOpen} onOpenChange={setMobileFilterOpen}>
              <DrawerTrigger asChild>
                <Button variant="secondary">
                  <ListFilter size={15} strokeWidth={1.75} aria-hidden="true" />
                  <span>筛选</span>
                  {mobileFilterCount > 0 && (
                    <Badge size="sm" tone="info" pill>
                      {mobileFilterCount}
                    </Badge>
                  )}
                </Button>
              </DrawerTrigger>
              <DrawerContent
                side="bottom"
                title="筛选代理服务"
                footer={
                  <div className="flex items-center justify-between gap-2">
                    <Button variant="secondary" disabled={!hasActiveFilter} onClick={resetFilters}>
                      清除筛选
                    </Button>
                    <Button onClick={() => setMobileFilterOpen(false)}>完成</Button>
                  </div>
                }
              >
                <div className="space-y-4">
                  <Select
                    label="所属节点"
                    value={node}
                    onValueChange={(value) => {
                      setNode(value);
                      setCursor(firstCursor);
                    }}
                    options={nodeOptions}
                  />
                  <Select
                    label="接入方式"
                    value={relayFilter}
                    onValueChange={(value) => {
                      setRelayFilter(value as RelayFilter);
                      setCursor(firstCursor);
                    }}
                    options={accessOptions}
                  />
                  <div className="space-y-1.5">
                    <span className="block text-(length:--text-xs) font-medium text-text-secondary">
                      代理引擎
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {engineOptions.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          aria-pressed={engine === opt.value}
                          onClick={() => {
                            setEngine(opt.value);
                            setCursor(firstCursor);
                          }}
                          className={`rounded-lg border-[1px] px-2.5 py-1.5 text-(length:--text-xs) ${
                            engine === opt.value
                              ? 'border-(--table-row-selected-border) bg-(--accent-subtle) font-medium text-foreground'
                              : 'border-border bg-surface text-text-secondary'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </DrawerContent>
            </Drawer>
          </div>

          <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
            <Button
              loading={loading}
              variant="secondary"
              disabled={loading}
              onClick={() => setReload((value) => value + 1)}
            >
              <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />
              刷新服务
            </Button>
            <Button
              disabled={!manageableNodes.length || !canManage}
              onClick={() => {
                focusRef.current =
                  document.activeElement instanceof HTMLElement ? document.activeElement : null;
                setAdding(true);
              }}
            >
              <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
              添加服务
            </Button>
          </div>
        </div>

        {(Boolean(data?.restricted) || Boolean(data?.managed_relay_count)) && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-(length:--text-xs) text-text-secondary">
            <span>{data?.restricted ? '部分节点的服务受权限限制未显示' : ''}</span>
            {Boolean(data?.managed_relay_count) && (
              <Link
                to="/proxy/relays"
                className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
              >
                另有 {data?.managed_relay_count} 条托管 Realm 规则在中转线路页管理
                <ArrowUpRight size={14} strokeWidth={1.75} aria-hidden="true" />
              </Link>
            )}
          </div>
        )}
      </div>

      <section aria-label="代理服务列表" className="min-w-0 space-y-4">
        {data === null && loading ? (
          <CardGridSkeleton count={6} cols="3col" label="正在读取代理服务" />
        ) : data === null ? (
          <div className="v-card">
            <EmptyStates headingLevel={3} compact variant="unknown" title="代理服务尚未读取" />
          </div>
        ) : rows.length === 0 ? (
          <div className="v-card">
            <EmptyStates
              headingLevel={3}
              compact
              variant={hasActiveFilter ? 'no-results' : 'empty'}
              title={hasActiveFilter ? '没有匹配的服务' : '暂无可查看的服务'}
              action={
                hasActiveFilter ? (
                  <Button variant="secondary" onClick={resetFilters}>
                    <ListFilter size={16} strokeWidth={1.75} aria-hidden="true" />
                    清除筛选
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((row) => {
              const syncFailed = row.engine.sync_state === 'failed';
              const syncErrorText = row.engine.sync_error_message
                ? row.engine.sync_error_message
                : row.engine.sync_error
                  ? engineSyncError(row.engine.sync_error)
                  : '';
              const canRetry = Boolean(
                canManage &&
                  row.node.can_manage &&
                  row.node.state === 'online' &&
                  syncFailed &&
                  !['unknown', 'degraded'].includes(row.engine.status),
              );
              const canConnect = Boolean(
                row.engine.name !== 'realm' &&
                  row.node.state === 'online' &&
                  row.runtime === '运行中' &&
                  !row.service.pending_delete,
              );
              const revText =
                row.engine.desired_revision !== row.engine.observed_revision
                  ? `r${row.engine.observed_revision}→r${row.engine.desired_revision}`
                  : `r${row.engine.observed_revision}`;
              const relaySummary = row.relays.length ? summarizeServiceRelays(row.relays) : null;
              const relayTone: BadgeTone = relaySummary
                ? relaySummary.attention > 0
                  ? 'danger'
                  : relaySummary.pending > 0
                    ? 'warning'
                    : relaySummary.available > 0
                      ? 'success'
                      : 'neutral'
                : 'neutral';
              const relayStatusText = relaySummary
                ? relaySummary.attention > 0
                  ? `${relaySummary.attention} 需处理`
                  : relaySummary.pending > 0
                    ? `${relaySummary.pending} 待确认`
                    : `${relaySummary.available} 可用`
                : '';

              return (
                <article
                  key={row.id}
                  data-card="service"
                  onClick={(event) => {
                    if (shouldHandleCardClick(event)) openInspector(row);
                  }}
                  className="flex min-w-0 cursor-pointer flex-col justify-between rounded-(--radius-surface) border-[1px] border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-surface-muted/30"
                >
                  <div className="space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          data-card-interactive="1"
                          onClick={() => openInspector(row)}
                          className="text-left text-(length:--text-sm) font-medium text-foreground hover:text-accent hover:underline wrap-anywhere"
                        >
                          {row.name}
                        </button>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-(length:--text-xs) text-text-secondary">
                          <span>{row.protocol}</span>
                          {row.service.preset_id && (
                            <Badge size="sm" tone="neutral">
                              {row.preset_name ? `预设 ${row.preset_name}` : '预设'}
                            </Badge>
                          )}
                          {(row.service.port_override || row.service.sni_override) && (
                            <Badge size="sm" tone="info">
                              覆盖
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 space-y-1 text-right">
                        <Badge size="sm" dot pill tone={runtimeBadgeTone(row.runtime)}>
                          {row.runtime}
                        </Badge>
                        <p className="text-(length:--text-xs) text-text-secondary tabular-nums">
                          {row.configuration} {revText}
                        </p>
                      </div>
                    </div>

                    {/* Sync error summary */}
                    {syncFailed && syncErrorText && (
                      <div className="flex items-start gap-1.5 rounded-(--radius-control) bg-(--danger-muted) px-2.5 py-1.5 text-(length:--text-xs) text-(--status-negative-text)">
                        <AlertTriangle
                          size={14}
                          strokeWidth={1.75}
                          className="mt-0.5 shrink-0"
                          aria-hidden="true"
                        />
                        <span className="wrap-anywhere">{syncErrorText}</span>
                      </div>
                    )}

                    {/* Primary info block */}
                    <div className="space-y-2 rounded-(--radius-control) border-[1px] border-border-subtle bg-surface-muted/50 p-3 text-(length:--text-xs)">
                      <div className="flex items-center justify-between gap-2">
                        <span className="shrink-0 text-text-secondary">节点与引擎</span>
                        <div className="flex min-w-0 items-center gap-1.5 truncate font-medium">
                          <span data-card-interactive="1" className="min-w-0 truncate">
                            <NodeStatusLink
                              id={row.node.id}
                              name={row.node.name}
                              state={row.node.state}
                              lastSeenAt={row.node.last_seen_at}
                            />
                          </span>
                          <span className="text-text-muted" aria-hidden="true">
                            /
                          </span>
                          <Link
                            to={nodeEnginePath(row.node.id, row.engine.name)}
                            data-card-interactive="1"
                            className="shrink-0 text-text-secondary tabular-nums hover:text-accent hover:underline"
                          >
                            {row.engine.name}
                            {row.engine.version ? ` ${row.engine.version}` : ''}
                          </Link>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <span className="shrink-0 text-text-secondary">直连接入</span>
                        <div className="flex min-w-0 items-center gap-1">
                          <span
                            className="truncate font-mono text-foreground tabular-nums"
                            title={`${row.endpoint}（监听 :${row.service.listen_port}）`}
                          >
                            {row.endpoint}
                          </span>
                          {row.endpoint !== '未配置' && (
                            <EndpointCopyButton
                              value={row.endpoint}
                              label="直连接入地址"
                              ariaLabel={`复制 ${row.name} 的直连接入地址`}
                            />
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <span className="shrink-0 text-text-secondary">关联中转</span>
                        {row.engine.name === 'realm' ? (
                          <span className="text-text-secondary">独立转发</span>
                        ) : relaySummary ? (
                          <button
                            type="button"
                            data-card-interactive="1"
                            onClick={() => openInspector(row)}
                            className="inline-flex items-center"
                          >
                            <Badge size="sm" dot pill tone={relayTone}>
                              {relaySummary.total} 条中转，{relayStatusText}
                            </Badge>
                          </button>
                        ) : row.relay_eligible && canManage ? (
                          <button
                            type="button"
                            data-card-interactive="1"
                            onClick={() => startAddRelay(row)}
                            className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
                          >
                            <Waypoints size={13} strokeWidth={1.75} aria-hidden="true" />
                            添加中转
                          </button>
                        ) : (
                          <span className="text-text-secondary">
                            {row.runtime === '运行中' ? '仅直连' : '发布后可中转'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Contextual Footer */}
                  <div className="mt-3 flex items-center justify-between gap-2 border-t-[1px] border-border-subtle pt-2.5">
                    {canRetry ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        data-card-interactive="1"
                        disabled={retrying}
                        onClick={() => void retrySync(row)}
                      >
                        <RefreshCw
                          size={14}
                          strokeWidth={1.75}
                          className="text-danger"
                          aria-hidden="true"
                        />
                        重试同步
                      </Button>
                    ) : canConnect ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        data-card-interactive="1"
                        disabled={revealing}
                        onClick={() => void reveal(row)}
                      >
                        <Link2 size={14} strokeWidth={1.75} aria-hidden="true" />
                        连接信息
                      </Button>
                    ) : (
                      <Link
                        to={nodeEnginePath(row.node.id, row.engine.name)}
                        data-card-interactive="1"
                        className="inline-flex items-center gap-1 text-(length:--text-xs) text-text-secondary hover:text-foreground"
                      >
                        前往节点管理
                        <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" />
                      </Link>
                    )}

                    <Button
                      size="sm"
                      variant="ghost"
                      data-card-interactive="1"
                      onClick={() => openInspector(row)}
                    >
                      <Eye size={14} strokeWidth={1.75} aria-hidden="true" />
                      详情
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {(shownCursor.history.length > 0 || data?.next_cursor) && (
          <Pagination
            label="代理服务分页"
            page={shownCursor.history.length + 1}
            busy={loading}
            hasNext={Boolean(data?.next_cursor)}
            onPageChange={(page) =>
              setCursor(cursorForPage(shownCursor, page, data?.next_cursor ?? ''))
            }
          />
        )}
      </section>

      <EngineConnectionsDialog
        connections={connections}
        relays={connectionRelays}
        online={data?.nodes.find((item) => item.id === connectionNode)?.state === 'online'}
        onClose={() => {
          setConnections(null);
          setConnectionRelays([]);
        }}
        returnFocus={connectionFocus.current}
      />

      <ServiceInspectorDrawer
        service={relayDraftTarget ? null : selected}
        canManage={canManage}
        revealing={revealing}
        retrying={retrying}
        onClose={closeInspector}
        onRevealConnections={(row) => void reveal(row)}
        onRetrySync={(row) => void retrySync(row)}
        onManageNodeEngine={(row) => navigate(nodeEnginePath(row.node.id, row.engine.name))}
        onAddRelay={startAddRelay}
        onPublishRelay={(route) => setRelayReview(route)}
        returnFocus={() => focusRef.current?.focus()}
      />

      {relayDraftTarget && (
        <RelayDraftDrawer
          key={`draft-${relayDraftTarget.id}`}
          initialEntry=""
          engine={relayDraftTarget.engine.id}
          service={relayDraftTarget.service.id}
          returnFocus={() => focusRef.current?.focus()}
          onClose={() => setRelayDraftTarget(null)}
          onSaved={(saved, shouldReview) => {
            setRelayDraftTarget(null);
            if (shouldReview && needsRelayPublication(saved)) setRelayReview(saved);
            setReload((value) => value + 1);
          }}
        />
      )}

      {relayReview && (
        <RelayPublishDialog
          route={relayReview}
          returnFocus={() => focusRef.current?.focus()}
          onClose={() => setRelayReview(null)}
          onSubmitted={() => {
            setRelayReview(null);
            setReload((value) => value + 1);
          }}
        />
      )}

      <AddServiceDialog
        open={adding}
        nodes={manageableNodes}
        onClose={() => setAdding(false)}
        onContinue={(nodeId, engineName) => {
          setAdding(false);
          void navigate(
            `/nodes/${encodeURIComponent(nodeId)}?tab=engines&engine=${engineName}&create=1`,
          );
        }}
        returnFocus={() => focusRef.current?.focus()}
      />
    </>
  );
}
