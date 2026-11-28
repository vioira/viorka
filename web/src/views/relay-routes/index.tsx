import { ArrowRight, Eye, ListFilter, Plus, RefreshCw, Send } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router';
import type { Session } from '@/api/auth';
import type { RelayRoute } from '@/api/relays';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { Drawer, DrawerContent, DrawerTrigger } from '@/components/arc/drawer/drawer';
import { SearchField } from '@/components/arc/search-field/search-field';
import { Select } from '@/components/arc/select/select';
import {
  CardGridSkeleton,
  EndpointCopyButton,
  type LensItem,
  LensStrip,
  shouldHandleCardClick,
} from '@/components/card-kit';
import EmptyStates from '@/components/empty-states';
import {
  endpointText,
  isNatMapped,
  isRelayAttention,
  isRelayPending,
  needsRelayPublication,
  nodeEnginePath,
  proxyServicePath,
  type RelayLens,
  type RelayStepState,
  relayStatusLabel,
  relayTone,
  relayVerificationSteps,
} from '@/components/proxy/relay-meta';
import RelayDiagnostics from './components/RelayDiagnostics';
import RelayDraftDrawer from './components/RelayDraftDrawer';
import RelayPublishDialog from './components/RelayPublishDialog';
import { useRelays } from './components/use-relays';

type RelaySort = 'attention' | 'name';

const stepDotClass: Record<RelayStepState, string> = {
  passed: 'bg-success',
  failed: 'bg-danger',
  pending: 'bg-warning',
  idle: 'bg-border-strong',
};

const stepShortLabel: Record<'apply' | 'dial' | 'public', string> = {
  apply: '应用',
  dial: '拨号',
  public: '公网',
};

function relayPriority(route: RelayRoute): number {
  if (isRelayAttention(route)) return 0;
  if (isRelayPending(route)) return 1;
  if (route.reason === 'available' && route.online && !route.public_stale) return 2;
  return 3;
}

export default function RelayRoutesPage() {
  const session = useOutletContext<Session>();
  const canManage = session.user.role !== 'viewer';
  const [params, setParams] = useSearchParams();
  const { data, busy, reload } = useRelays();

  const [lens, setLens] = useState<RelayLens>('all');
  const [query, setQuery] = useState('');
  const [entryFilter, setEntryFilter] = useState(() => params.get('filterEntry') ?? 'all');
  const [landingFilter, setLandingFilter] = useState(() => params.get('filterLanding') ?? 'all');
  const [sort, setSort] = useState<RelaySort>('attention');
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);

  const [editRoute, setEditRoute] = useState<RelayRoute | null>(null);
  const [reviewRoute, setReviewRoute] = useState<RelayRoute | null>(null);

  const createTrigger = useRef<HTMLButtonElement | null>(null);
  const focusRef = useRef<HTMLElement | null>(null);

  const rememberFocus = () => {
    focusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };
  const returnFocus = () => {
    (focusRef.current?.isConnected ? focusRef.current : createTrigger.current)?.focus();
  };

  const preselectLandingEngine = params.get('landing') ?? '';
  const preselectLandingService = params.get('service') ?? '';
  const preselectEntry = params.get('entry') ?? '';
  const selectedRouteId = params.get('route');
  const creatingFromQuery =
    canManage &&
    (params.get('create') === '1' || Boolean(preselectLandingEngine && preselectLandingService));

  const allRoutes = data?.items ?? [];

  const counts = useMemo(
    () => ({
      all: allRoutes.length,
      available: allRoutes.filter((r) => r.reason === 'available' && r.online && !r.public_stale)
        .length,
      pending: allRoutes.filter(isRelayPending).length,
      attention: allRoutes.filter(isRelayAttention).length,
    }),
    [allRoutes],
  );

  const entryOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of allRoutes) {
      if (r.entry_node && !map.has(r.entry_node))
        map.set(r.entry_node, r.entry_name || r.entry_node);
    }
    return [
      { value: 'all', label: '全部入口节点' },
      ...Array.from(map.entries()).map(([value, label]) => ({ value, label })),
    ];
  }, [allRoutes]);

  const landingOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of allRoutes) {
      if (r.cleanup_only) continue;
      const key = `${r.draft.landing_engine_id}/${r.draft.landing_service_id}`;
      if (r.draft.landing_service_id && !map.has(key)) {
        map.set(key, r.draft.landing_name || r.draft.landing_service_id);
      }
    }
    return [
      { value: 'all', label: '全部落地服务' },
      ...Array.from(map.entries()).map(([value, label]) => ({ value, label })),
    ];
  }, [allRoutes]);

  const search = query.trim().toLocaleLowerCase();
  const visibleRoutes = useMemo(() => {
    const filtered = allRoutes.filter((r) => {
      if (lens === 'available' && !(r.reason === 'available' && r.online && !r.public_stale))
        return false;
      if (lens === 'pending' && !isRelayPending(r)) return false;
      if (lens === 'attention' && !isRelayAttention(r)) return false;
      if (entryFilter !== 'all' && r.entry_node !== entryFilter) return false;
      if (
        landingFilter !== 'all' &&
        `${r.draft.landing_engine_id}/${r.draft.landing_service_id}` !== landingFilter
      ) {
        return false;
      }
      if (
        search &&
        ![
          r.draft.name,
          r.entry_name,
          r.draft.landing_name,
          endpointText(r.draft.public),
          endpointText(r.draft.dial),
          r.id,
        ]
          .join(' ')
          .toLocaleLowerCase()
          .includes(search)
      ) {
        return false;
      }
      return true;
    });

    return [...filtered].sort((a, b) => {
      if (sort === 'attention') {
        const diff = relayPriority(a) - relayPriority(b);
        if (diff !== 0) return diff;
      }
      return a.draft.name.localeCompare(b.draft.name, 'zh-CN');
    });
  }, [allRoutes, lens, entryFilter, landingFilter, search, sort]);

  const selectedRoute = useMemo(
    () => (selectedRouteId ? (allRoutes.find((r) => r.id === selectedRouteId) ?? null) : null),
    [allRoutes, selectedRouteId],
  );

  const hasActiveFilter =
    lens !== 'all' || Boolean(query) || entryFilter !== 'all' || landingFilter !== 'all';
  const mobileFilterCount =
    (entryFilter !== 'all' ? 1 : 0) +
    (landingFilter !== 'all' ? 1 : 0) +
    (sort !== 'attention' ? 1 : 0);

  function resetFilters() {
    setLens('all');
    setQuery('');
    setEntryFilter('all');
    setLandingFilter('all');
    setSort('attention');
  }

  function openRoute(routeId: string) {
    rememberFocus();
    const next = new URLSearchParams(params);
    next.set('route', routeId);
    next.delete('create');
    next.delete('landing');
    next.delete('service');
    next.delete('entry');
    setParams(next);
  }

  function closeRoute() {
    const next = new URLSearchParams(params);
    next.delete('route');
    setParams(next, { replace: true });
  }

  function openCreate() {
    rememberFocus();
    const next = new URLSearchParams(params);
    next.set('create', '1');
    next.delete('route');
    setParams(next);
  }

  function clearCreateParams() {
    const next = new URLSearchParams(params);
    next.delete('create');
    next.delete('landing');
    next.delete('service');
    next.delete('entry');
    setParams(next, { replace: true });
  }

  const lenses: LensItem<RelayLens>[] = [
    { key: 'all', label: '全部线路', count: counts.all },
    { key: 'available', label: '可供订阅', count: counts.available, dotClass: 'bg-success' },
    {
      key: 'pending',
      label: '待发布或验证',
      count: counts.pending,
      dotClass: counts.pending > 0 ? 'bg-warning' : undefined,
    },
    {
      key: 'attention',
      label: '需处理',
      count: counts.attention,
      dotClass: counts.attention > 0 ? 'bg-danger' : undefined,
    },
  ];

  const sortOptions = [
    { value: 'attention', label: '排序：需处理优先' },
    { value: 'name', label: '排序：名称' },
  ];

  return (
    <>
      <LensStrip
        items={lenses}
        activeKey={lens}
        loaded={data !== null}
        label="按分发与验证状态筛选中转线路"
        onChange={setLens}
      />

      <div className="flex flex-wrap items-center gap-2.5">
        <div className="min-w-44 flex-1 sm:max-w-72">
          <SearchField
            hideLabel
            label="搜索中转线路"
            placeholder="线路名、入口节点、公网地址或落地"
            value={query}
            onValueChange={setQuery}
          />
        </div>

        <div className="hidden flex-wrap items-center gap-2.5 sm:flex">
          <div className="w-40">
            <Select
              hideLabel
              label="入口节点"
              value={entryFilter}
              onValueChange={setEntryFilter}
              options={entryOptions}
            />
          </div>
          <div className="w-44">
            <Select
              hideLabel
              label="落地服务"
              value={landingFilter}
              onValueChange={setLandingFilter}
              options={landingOptions}
            />
          </div>
          <div className="w-44">
            <Select
              hideLabel
              label="中转线路排序"
              value={sort}
              onValueChange={(value) => setSort(value as RelaySort)}
              options={sortOptions}
            />
          </div>
        </div>

        <div className="sm:hidden">
          <Drawer open={mobileFilterOpen} onOpenChange={setMobileFilterOpen}>
            <DrawerTrigger asChild>
              <Button variant="secondary">
                <ListFilter size={15} strokeWidth={1.75} aria-hidden="true" />
                <span>筛选与排序</span>
                {mobileFilterCount > 0 && (
                  <Badge size="sm" tone="info" pill>
                    {mobileFilterCount}
                  </Badge>
                )}
              </Button>
            </DrawerTrigger>
            <DrawerContent
              side="bottom"
              title="筛选与排序中转线路"
              footer={
                <div className="flex items-center justify-between gap-2">
                  <Button
                    variant="secondary"
                    disabled={!hasActiveFilter && sort === 'attention'}
                    onClick={resetFilters}
                  >
                    清除筛选
                  </Button>
                  <Button onClick={() => setMobileFilterOpen(false)}>完成</Button>
                </div>
              }
            >
              <div className="space-y-4">
                <Select
                  label="排序方式"
                  value={sort}
                  onValueChange={(value) => setSort(value as RelaySort)}
                  options={sortOptions}
                />
                <Select
                  label="入口节点"
                  value={entryFilter}
                  onValueChange={setEntryFilter}
                  options={entryOptions}
                />
                <Select
                  label="落地服务"
                  value={landingFilter}
                  onValueChange={setLandingFilter}
                  options={landingOptions}
                />
              </div>
            </DrawerContent>
          </Drawer>
        </div>

        <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
          <Button loading={busy} variant="secondary" disabled={busy} onClick={() => void reload()}>
            <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />
            刷新线路
          </Button>
          {canManage && (
            <Button ref={createTrigger} onClick={openCreate}>
              <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
              创建中转线路
            </Button>
          )}
        </div>
      </div>

      <section aria-label="中转线路列表" className="min-w-0">
        {data === null && busy ? (
          <CardGridSkeleton count={4} cols="2col" label="正在读取中转线路" />
        ) : data === null ? (
          <div className="v-card">
            <EmptyStates headingLevel={3} compact variant="unknown" title="中转线路尚未读取" />
          </div>
        ) : visibleRoutes.length === 0 ? (
          <div className="v-card">
            <EmptyStates
              headingLevel={3}
              compact
              variant={hasActiveFilter ? 'no-results' : 'unconfigured'}
              title={allRoutes.length > 0 ? '没有匹配的中转线路' : '暂无中转线路'}
              description={
                !hasActiveFilter && allRoutes.length === 0
                  ? '将入口 Realm 节点与已运行的落地代理服务绑定，经过公网验证后即可供订阅选择。'
                  : undefined
              }
              action={
                hasActiveFilter ? (
                  <Button variant="secondary" onClick={resetFilters}>
                    <ListFilter size={16} strokeWidth={1.75} aria-hidden="true" />
                    清除筛选
                  </Button>
                ) : canManage ? (
                  <Button onClick={openCreate}>
                    <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
                    创建中转线路
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {visibleRoutes.map((r) => {
              const path = r.serving_path ?? r.published ?? r.draft;
              const nat = isNatMapped(path);
              const publicAddr = endpointText(path.public);
              const steps = relayVerificationSteps(r);
              const draftPending = Boolean(r.published && r.published.version !== r.draft.version);
              const showQuickPublish =
                canManage &&
                r.can_manage &&
                !r.cleanup_only &&
                r.reason !== 'landing_changed' &&
                needsRelayPublication(r) &&
                Boolean(r.publish_base);

              return (
                <article
                  key={r.id}
                  data-card="relay"
                  onClick={(event) => {
                    if (shouldHandleCardClick(event)) openRoute(r.id);
                  }}
                  className="flex min-w-0 cursor-pointer flex-col justify-between space-y-3 rounded-(--radius-surface) border-[1px] border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-surface-muted/30"
                >
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          data-card-interactive="1"
                          onClick={() => openRoute(r.id)}
                          className="text-left text-(length:--text-sm) font-medium text-foreground hover:text-accent hover:underline wrap-anywhere"
                        >
                          {r.draft.name}
                        </button>
                        {draftPending && (
                          <Badge size="sm" tone="warning">
                            草稿待发
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-(length:--text-xs) text-text-secondary tabular-nums">
                        <Link
                          to={nodeEnginePath(r.entry_node, 'realm')}
                          data-card-interactive="1"
                          className="inline-flex items-center gap-1.5 hover:text-accent hover:underline"
                        >
                          <span
                            className={`size-1.5 shrink-0 rounded-full ${r.online ? 'bg-success' : 'bg-danger'}`}
                            aria-hidden="true"
                          />
                          <span>入口 {r.entry_name}</span>
                        </Link>
                        {r.serving_revision > 0 && (
                          <span>
                            生效 r{r.serving_revision}
                            {r.public_stale ? '，公网需重测' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                    <Badge size="sm" dot pill tone={relayTone(r)} className="shrink-0">
                      {relayStatusLabel(r)}
                    </Badge>
                  </div>

                  {/* Visual Forwarding Chain */}
                  <div className="grid grid-cols-1 items-center gap-2 rounded-(--radius-control) border-[1px] border-border-subtle bg-surface-muted/50 p-3 text-(length:--text-xs) sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-text-secondary">公网入口</span>
                        {publicAddr !== '未填写' && (
                          <EndpointCopyButton
                            value={publicAddr}
                            label="公网入口地址"
                            ariaLabel={`复制 ${r.draft.name} 的公网入口地址`}
                          />
                        )}
                      </div>
                      <p className="truncate font-mono font-medium text-foreground tabular-nums">
                        {publicAddr}
                      </p>
                      {nat ? (
                        <Badge size="sm" tone="info">
                          NAT 监听 :{path.listen.port}
                        </Badge>
                      ) : (
                        <span className="block text-text-secondary">直连监听</span>
                      )}
                    </div>

                    <div
                      className="flex items-center justify-center py-0.5 text-text-muted sm:py-0"
                      aria-hidden="true"
                    >
                      <ArrowRight size={15} strokeWidth={1.75} className="rotate-90 sm:rotate-0" />
                    </div>

                    <div className="min-w-0 space-y-1">
                      <span className="block text-text-secondary">落地服务</span>
                      {r.cleanup_only ? (
                        <p className="font-medium text-danger">受限落地</p>
                      ) : (
                        <>
                          <Link
                            to={proxyServicePath(path.landing_engine_id, path.landing_service_id)}
                            data-card-interactive="1"
                            className="block truncate font-medium text-accent hover:underline"
                          >
                            {path.landing_name || '落地服务'}
                          </Link>
                          <p className="truncate font-mono text-text-secondary tabular-nums">
                            拨号 {endpointText(path.dial)}
                          </p>
                        </>
                      )}
                    </div>
                  </div>

                  {/* 3-Step Verification Progress Grid */}
                  <div className="grid grid-cols-3 gap-2 text-(length:--text-xs)">
                    {steps.map((step) => (
                      <div
                        key={step.key}
                        title={`${step.title}：${step.detail}`}
                        className="min-w-0 space-y-0.5 rounded-lg border-[1px] border-border-subtle bg-surface px-2.5 py-1.5"
                      >
                        <div className="flex items-center gap-1.5 font-medium text-foreground">
                          <span
                            className={`size-1.5 shrink-0 rounded-full ${stepDotClass[step.state]}`}
                            aria-hidden="true"
                          />
                          <span>{stepShortLabel[step.key]}</span>
                        </div>
                        <p
                          className={`truncate ${
                            step.state === 'failed'
                              ? 'font-medium text-danger'
                              : 'text-text-secondary'
                          }`}
                        >
                          {step.statusText}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between gap-2 border-t-[1px] border-border-subtle pt-2.5">
                    <div>
                      {showQuickPublish ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          data-card-interactive="1"
                          onClick={() => {
                            rememberFocus();
                            setReviewRoute(r);
                          }}
                        >
                          <Send size={14} strokeWidth={1.75} aria-hidden="true" />
                          发布变更
                        </Button>
                      ) : (
                        <span className="text-(length:--text-xs) text-text-secondary">
                          点击卡片查看完整诊断
                        </span>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      data-card-interactive="1"
                      onClick={() => openRoute(r.id)}
                    >
                      <Eye size={14} strokeWidth={1.75} aria-hidden="true" />
                      诊断
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <RelayDiagnostics
        route={editRoute ? null : selectedRoute}
        onClose={closeRoute}
        onChange={reload}
        onEdit={(target) => {
          rememberFocus();
          setEditRoute(target);
        }}
        onPublish={(target) => {
          rememberFocus();
          setReviewRoute(target);
        }}
        returnFocus={returnFocus}
      />

      {(creatingFromQuery || editRoute) && (
        <RelayDraftDrawer
          key={
            editRoute?.id ??
            `${preselectLandingEngine}/${preselectLandingService}/${preselectEntry}`
          }
          initialEntry={preselectEntry}
          engine={editRoute?.draft.landing_engine_id ?? preselectLandingEngine}
          service={editRoute?.draft.landing_service_id ?? preselectLandingService}
          route={editRoute ?? undefined}
          returnFocus={returnFocus}
          onSaved={(saved, shouldReview) => {
            setQuery('');
            setLens('all');
            setEntryFilter('all');
            setLandingFilter('all');
            setEditRoute(null);
            if (shouldReview && needsRelayPublication(saved)) setReviewRoute(saved);
            openRoute(saved.id);
            void reload();
          }}
          onClose={() => {
            setEditRoute(null);
            if (!editRoute) clearCreateParams();
          }}
        />
      )}

      {reviewRoute && (
        <RelayPublishDialog
          route={reviewRoute}
          returnFocus={returnFocus}
          onClose={() => setReviewRoute(null)}
          onSubmitted={() => {
            setReviewRoute(null);
            void reload();
          }}
        />
      )}
    </>
  );
}
