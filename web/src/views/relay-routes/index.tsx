import { ArrowRight, Eye, ListFilter, Plus, RefreshCw, Send } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router';
import type { Session } from '@/api/auth';
import type { RelayRoute } from '@/api/relays';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { SearchField } from '@/components/arc/search-field/search-field';
import { Select } from '@/components/arc/select/select';
import DataTable, { type DataColumn } from '@/components/data-table';
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

type RelayTableRow = {
  id: string;
  name: string;
  entrySort: string;
  landingSort: string;
  statusSort: string;
  route: RelayRoute;
};

export default function RelayRoutesPage() {
  const session = useOutletContext<Session>();
  const canManage = session.user.role !== 'viewer';
  const [params, setParams] = useSearchParams();
  const { data, busy, reload } = useRelays();

  const [lens, setLens] = useState<RelayLens>('all');
  const [query, setQuery] = useState('');
  const [entryFilter, setEntryFilter] = useState(() => params.get('filterEntry') ?? 'all');
  const [landingFilter, setLandingFilter] = useState(() => params.get('filterLanding') ?? 'all');

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
  const rows: RelayTableRow[] = useMemo(
    () =>
      allRoutes
        .filter((r) => {
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
        })
        .map((route) => ({
          id: route.id,
          name: route.draft.name,
          entrySort: route.entry_name,
          landingSort: route.draft.landing_name,
          statusSort: relayStatusLabel(route),
          route,
        })),
    [allRoutes, lens, entryFilter, landingFilter, search],
  );

  const selectedRoute = useMemo(
    () => (selectedRouteId ? (allRoutes.find((r) => r.id === selectedRouteId) ?? null) : null),
    [allRoutes, selectedRouteId],
  );

  const hasActiveFilter =
    lens !== 'all' || Boolean(query) || entryFilter !== 'all' || landingFilter !== 'all';

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

  const lenses: { key: RelayLens; label: string; count: number; dotClass?: string }[] = [
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

  const columns: DataColumn<RelayTableRow>[] = [
    {
      key: 'name',
      label: '线路与入口',
      render: (_, { route: r }) => (
        <div className="max-w-56 space-y-1 wrap-anywhere">
          <button
            type="button"
            onClick={() => openRoute(r.id)}
            className="text-left font-medium text-foreground hover:text-accent hover:underline wrap-anywhere"
          >
            {r.draft.name}
          </button>
          <div className="flex flex-wrap items-center gap-2 text-(length:--text-xs) text-text-secondary">
            <Link
              to={nodeEnginePath(r.entry_node, 'realm')}
              className="inline-flex items-center gap-1.5 hover:text-accent hover:underline"
            >
              <span
                className={`size-1.5 shrink-0 rounded-full ${r.online ? 'bg-success' : 'bg-danger'}`}
                aria-hidden="true"
              />
              <span>{r.entry_name}</span>
            </Link>
            {r.published && r.published.version !== r.draft.version && (
              <Badge size="sm" tone="warning">
                草稿待发
              </Badge>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'landingSort',
      label: '转发链路',
      render: (_, { route: r }) => {
        const path = r.serving_path ?? r.published ?? r.draft;
        const nat = isNatMapped(path);
        return (
          <div className="min-w-60 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5 text-(length:--text-xs)">
              <span className="font-mono font-medium tabular-nums text-foreground wrap-anywhere">
                {endpointText(path.public)}
              </span>
              {nat && (
                <Badge size="sm" tone="info">
                  NAT :{path.listen.port}
                </Badge>
              )}
              <ArrowRight
                size={13}
                strokeWidth={1.75}
                className="shrink-0 text-text-muted"
                aria-hidden="true"
              />
              {r.cleanup_only ? (
                <span className="text-danger">受限落地</span>
              ) : (
                <Link
                  to={proxyServicePath(path.landing_engine_id, path.landing_service_id)}
                  className="font-medium text-accent hover:underline wrap-anywhere"
                >
                  {path.landing_name || '落地服务'}
                </Link>
              )}
            </div>
            {!r.cleanup_only && (
              <p className="font-mono text-(length:--text-xs) text-text-secondary tabular-nums wrap-anywhere">
                拨号 {endpointText(path.dial)}
              </p>
            )}
          </div>
        );
      },
    },
    {
      key: 'checks',
      label: '三段验证',
      sortable: false,
      render: (_, { route: r }) => {
        const steps = relayVerificationSteps(r);
        return (
          <div className="flex flex-wrap items-center gap-2 text-(length:--text-xs) text-text-secondary">
            {steps.map((step) => (
              <span
                key={step.key}
                title={`${step.title}：${step.statusText}`}
                className="inline-flex items-center gap-1 rounded-(--radius-control) border-[1px] border-border-subtle bg-background px-2 py-0.5"
              >
                <span
                  className={`size-1.5 shrink-0 rounded-full ${stepDotClass[step.state]}`}
                  aria-hidden="true"
                />
                <span>{stepShortLabel[step.key]}</span>
              </span>
            ))}
          </div>
        );
      },
    },
    {
      key: 'statusSort',
      label: '订阅状态',
      render: (_, { route: r }) => (
        <div className="space-y-1">
          <Badge size="sm" dot tone={relayTone(r)}>
            {relayStatusLabel(r)}
          </Badge>
          {r.serving_revision > 0 && (
            <p className="font-mono text-(length:--text-xs) text-text-secondary tabular-nums">
              生效 r{r.serving_revision}
              {r.public_stale ? '，需重测' : ''}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      label: '操作',
      sortable: false,
      render: (_, { route: r }) => {
        const showQuickPublish =
          canManage &&
          r.can_manage &&
          !r.cleanup_only &&
          r.reason !== 'landing_changed' &&
          needsRelayPublication(r) &&
          Boolean(r.publish_base);
        return (
          <div className="flex items-center gap-2">
            {showQuickPublish && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  rememberFocus();
                  setReviewRoute(r);
                }}
              >
                <Send size={14} strokeWidth={1.75} aria-hidden="true" />
                发布
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => openRoute(r.id)}>
              <Eye size={14} strokeWidth={1.75} aria-hidden="true" />
              诊断
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <>
      <div
        role="group"
        aria-label="按分发与验证状态筛选中转线路"
        className="grid grid-cols-2 divide-y-[1px] divide-border-subtle overflow-hidden rounded-(--radius-surface) border-[1px] border-border bg-surface sm:grid-cols-4 sm:divide-x-[1px] sm:divide-y-0"
      >
        {lenses.map((item) => {
          const active = lens === item.key;
          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={active}
              onClick={() => setLens(item.key)}
              className={`flex items-center justify-between gap-2 px-4 py-3.5 text-left transition-colors ${
                active ? 'bg-surface-muted' : 'hover:bg-background'
              }`}
            >
              <div className="min-w-0">
                <p
                  className={`flex items-center gap-1.5 truncate text-(length:--text-xs) ${
                    active ? 'font-medium text-foreground' : 'text-text-secondary'
                  }`}
                >
                  {item.dotClass && (
                    <span
                      className={`size-1.5 shrink-0 rounded-full ${item.dotClass}`}
                      aria-hidden="true"
                    />
                  )}
                  <span className="truncate">{item.label}</span>
                </p>
                <p className="mt-1 text-(length:--text-lg) font-medium tabular-nums text-foreground">
                  {data ? item.count : '-'}
                </p>
              </div>
              {active && (
                <Badge size="sm" tone="neutral">
                  已选
                </Badge>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
          <div className="min-w-52 flex-1 sm:max-w-72">
            <SearchField
              hideLabel
              label="搜索中转线路"
              placeholder="线路名、入口节点、公网地址或落地"
              value={query}
              onValueChange={setQuery}
            />
          </div>
          <div className="w-full sm:w-44">
            <Select
              hideLabel
              label="入口节点"
              value={entryFilter}
              onValueChange={setEntryFilter}
              options={entryOptions}
            />
          </div>
          <div className="w-full sm:w-48">
            <Select
              hideLabel
              label="落地服务"
              value={landingFilter}
              onValueChange={setLandingFilter}
              options={landingOptions}
            />
          </div>
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

      <section className="v-card" aria-label="中转线路列表">
        <DataTable
          loaded={data !== null}
          loading={busy}
          rows={rows}
          columns={columns}
          rowKey="id"
          caption="中转线路"
          emptyMessage={allRoutes.length > 0 ? '没有匹配的中转线路' : '暂无中转线路'}
          emptyState={{
            variant: hasActiveFilter ? 'no-results' : 'unconfigured',
            description:
              !hasActiveFilter && allRoutes.length === 0
                ? '将入口 Realm 节点与已运行的落地代理服务绑定，经过公网验证后即可供订阅选择。'
                : undefined,
            action: hasActiveFilter ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setLens('all');
                  setQuery('');
                  setEntryFilter('all');
                  setLandingFilter('all');
                }}
              >
                <ListFilter size={16} strokeWidth={1.75} aria-hidden="true" />
                清除筛选
              </Button>
            ) : canManage ? (
              <Button onClick={openCreate}>
                <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
                创建中转线路
              </Button>
            ) : undefined,
          }}
        />
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
