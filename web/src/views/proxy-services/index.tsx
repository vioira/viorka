import { ArrowUpRight, Eye, Link2, ListFilter, Plus, RefreshCw, Waypoints } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router';
import type { Session } from '@/api/auth';
import { type Connection, engineConnections, engineNames, retryEngineSync } from '@/api/engines';
import type { RelayRoute } from '@/api/relays';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { SearchField } from '@/components/arc/search-field/search-field';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { Select } from '@/components/arc/select/select';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import DataTable, { type DataColumn } from '@/components/data-table';
import EngineConnectionsDialog from '@/components/engine-connections';
import { NodeStatusLink } from '@/components/node-status';
import {
  needsRelayPublication,
  nodeEnginePath,
  summarizeServiceRelays,
} from '@/components/proxy/relay-meta';
import { useServerEvent } from '@/hooks/realtime';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import RelayDraftDrawer from '@/views/relay-routes/components/RelayDraftDrawer';
import RelayPublishDialog from '@/views/relay-routes/components/RelayPublishDialog';
import AddServiceDialog from './components/AddServiceDialog';
import ServiceInspectorDrawer, { ServiceStatus } from './components/ServiceInspectorDrawer';
import {
  isServiceAttention,
  isServicePending,
  loadServices,
  type ServiceRow,
} from './service-data';

type StatusLens = 'all' | 'running' | 'pending' | 'attention';
type RelayFilter = 'all' | 'relayed' | 'direct';

export default function ProxyServicesPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const session = useOutletContext<Session>();
  const { toast } = useToastStack();
  const canManage = session.user.role !== 'viewer';

  const [data, setData] = useState<Awaited<ReturnType<typeof loadServices>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [, report] = useToastFeedback('error');

  const [lens, setLens] = useState<StatusLens>('all');
  const [query, setQuery] = useState('');
  const [node, setNode] = useState('all');
  const [engine, setEngine] = useState('all');
  const [relayFilter, setRelayFilter] = useState<RelayFilter>('all');

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
    loadServices(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          report(error instanceof Error ? error.message : '无法读取代理服务，请刷新重试');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reload, report]);

  useServerEvent(
    (event) => {
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

  const allRows = data?.rows ?? [];
  const selectedId = params.get('service');
  const selected = useMemo(
    () => (selectedId ? (allRows.find((item) => item.id === selectedId) ?? null) : null),
    [allRows, selectedId],
  );

  const counts = useMemo(
    () => ({
      all: allRows.length,
      running: allRows.filter((row) => row.runtime === '运行中').length,
      pending: allRows.filter(isServicePending).length,
      attention: allRows.filter(isServiceAttention).length,
    }),
    [allRows],
  );

  const search = query.trim().toLocaleLowerCase();
  const rows = useMemo(
    () =>
      allRows.filter((row) => {
        if (lens === 'running' && row.runtime !== '运行中') return false;
        if (lens === 'pending' && !isServicePending(row)) return false;
        if (lens === 'attention' && !isServiceAttention(row)) return false;
        if (node !== 'all' && row.node.id !== node) return false;
        if (engine !== 'all' && row.engine.name !== engine) return false;
        if (relayFilter === 'relayed' && row.relays.length === 0) return false;
        if (relayFilter === 'direct' && (row.relays.length > 0 || row.engine.name === 'realm'))
          return false;
        if (
          search &&
          ![
            row.name,
            row.service.id,
            row.node.name,
            row.endpoint,
            row.protocol,
            row.presetName,
            ...row.relays.map((r) => `${r.draft.name} ${r.entry_name}`),
          ]
            .join(' ')
            .toLocaleLowerCase()
            .includes(search)
        ) {
          return false;
        }
        return true;
      }),
    [allRows, lens, node, engine, relayFilter, search],
  );

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

  const hasActiveFilter =
    lens !== 'all' || Boolean(query) || node !== 'all' || engine !== 'all' || relayFilter !== 'all';

  const lenses: { key: StatusLens; label: string; count: number; dotClass?: string }[] = [
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

  const columns: DataColumn<ServiceRow>[] = [
    {
      key: 'name',
      label: '服务与协议',
      render: (_, row) => (
        <div className="max-w-56 space-y-1 wrap-anywhere">
          <button
            type="button"
            onClick={() => openInspector(row)}
            className="text-left font-medium text-foreground hover:text-accent hover:underline wrap-anywhere"
          >
            {row.name}
          </button>
          <div className="flex flex-wrap items-center gap-1.5 text-(length:--text-xs) text-text-secondary">
            <span>{row.protocol}</span>
            {row.service.preset_id && (
              <Badge size="sm" tone="neutral">
                预设
              </Badge>
            )}
            {(row.service.port_override || row.service.sni_override) && (
              <Badge size="sm" tone="info">
                覆盖
              </Badge>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'node',
      label: '节点与引擎',
      sortable: false,
      render: (_, row) => (
        <div className="max-w-48 space-y-1 wrap-anywhere">
          <NodeStatusLink
            id={row.node.id}
            name={row.node.name}
            state={row.node.state}
            lastSeenAt={row.node.last_seen_at}
          />
          <p className="text-(length:--text-xs) text-text-secondary tabular-nums">
            <Link
              to={nodeEnginePath(row.node.id, row.engine.name)}
              className="hover:text-accent hover:underline"
            >
              {row.engine.name}
              {row.engine.version ? ` ${row.engine.version}` : ''}
            </Link>
          </p>
        </div>
      ),
    },
    {
      key: 'endpoint',
      label: '直连接入',
      render: (_, row) => (
        <div className="space-y-1">
          <p className="font-mono text-(length:--text-xs) tabular-nums wrap-anywhere">
            {row.endpoint}
          </p>
          <p className="text-(length:--text-xs) text-text-secondary tabular-nums">
            监听 :{row.service.listen_port}
          </p>
        </div>
      ),
    },
    {
      key: 'relays',
      label: '关联中转',
      sortable: false,
      render: (_, row) => {
        if (row.engine.name === 'realm') {
          return <span className="text-(length:--text-xs) text-text-muted">独立转发</span>;
        }
        if (data && !data.relaysLoaded) {
          return <span className="text-(length:--text-xs) text-text-muted">中转未读取</span>;
        }
        if (row.relays.length > 0) {
          const summary = summarizeServiceRelays(row.relays);
          const tone =
            summary.attention > 0
              ? 'danger'
              : summary.pending > 0
                ? 'warning'
                : summary.available > 0
                  ? 'success'
                  : 'neutral';
          const statusSummary =
            summary.attention > 0
              ? `${summary.attention} 需处理`
              : summary.pending > 0
                ? `${summary.pending} 待确认`
                : `${summary.available} 可用`;
          return (
            <button
              type="button"
              onClick={() => openInspector(row)}
              className="inline-flex flex-col items-start gap-1 text-left group"
            >
              <Badge size="sm" dot tone={tone}>
                {summary.total} 条中转，{statusSummary}
              </Badge>
              <span className="max-w-44 truncate text-(length:--text-xs) text-text-secondary group-hover:text-accent">
                {row.relays.map((r) => r.entry_name).join('、')}
              </span>
            </button>
          );
        }
        if (row.relayEligible && canManage) {
          return (
            <Button size="sm" variant="ghost" onClick={() => startAddRelay(row)}>
              <Waypoints size={14} strokeWidth={1.75} aria-hidden="true" />
              添加中转
            </Button>
          );
        }
        return (
          <span className="text-(length:--text-xs) text-text-secondary">
            {row.runtime === '运行中' ? '仅直连' : '发布后可中转'}
          </span>
        );
      },
    },
    {
      key: 'runtime',
      label: '运行与同步',
      render: (_, row) => (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <ServiceStatus value={row.runtime} />
            <ServiceStatus value={row.configuration} />
          </div>
          <p className="text-(length:--text-xs) text-text-secondary tabular-nums">
            {row.engine.desired_revision !== row.engine.observed_revision
              ? `目标 r${row.engine.desired_revision} 实测 r${row.engine.observed_revision}`
              : `版本 r${row.engine.observed_revision}`}
          </p>
        </div>
      ),
    },
    {
      key: 'action',
      label: '操作',
      sortable: false,
      render: (_, row) => (
        <div className="flex items-center gap-2">
          {row.engine.name !== 'realm' && (
            <Button
              size="sm"
              variant="secondary"
              disabled={
                revealing ||
                row.node.state !== 'online' ||
                row.runtime !== '运行中' ||
                row.service.pending_delete
              }
              onClick={() => void reveal(row)}
            >
              <Link2 size={15} strokeWidth={1.75} aria-hidden="true" />
              连接
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => openInspector(row)}>
            <Eye size={15} strokeWidth={1.75} aria-hidden="true" />
            详情
          </Button>
        </div>
      ),
    },
  ];

  const nodeOptions = [
    { value: 'all', label: '全部节点' },
    ...(data?.nodes ?? []).map((item) => ({ value: item.id, label: item.name })),
  ];

  return (
    <>
      <div
        role="group"
        aria-label="按运行与同步状态筛选服务"
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

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
            <div className="min-w-52 flex-1 sm:max-w-72">
              <SearchField
                hideLabel
                label="搜索服务"
                placeholder="服务名、节点、端口或关联中转"
                value={query}
                onValueChange={setQuery}
              />
            </div>
            <div className="w-full sm:w-40">
              <Select
                hideLabel
                label="节点"
                value={node}
                onValueChange={setNode}
                options={nodeOptions}
              />
            </div>
            <div className="w-full sm:w-36">
              <Select
                hideLabel
                label="接入方式"
                value={relayFilter}
                onValueChange={(value) => setRelayFilter(value as RelayFilter)}
                options={[
                  { value: 'all', label: '全部接入' },
                  { value: 'relayed', label: '已关联中转' },
                  { value: 'direct', label: '仅直连' },
                ]}
              />
            </div>
            <SegmentedControl
              label="按引擎筛选"
              value={engine}
              onValueChange={setEngine}
              options={[
                { value: 'all', label: '全部引擎' },
                ...engineNames.map((value) => ({ value, label: value })),
              ]}
            />
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
              disabled={!data || !canManage}
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

        {(Boolean(data?.restricted) || Boolean(data?.managedRelayCount)) && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-(length:--text-xs) text-text-secondary">
            <span>{data?.restricted ? '部分节点的服务受权限限制未显示' : ''}</span>
            {Boolean(data?.managedRelayCount) && (
              <Link
                to="/proxy/relays"
                className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
              >
                另有 {data?.managedRelayCount} 条托管 Realm 规则在中转线路页管理
                <ArrowUpRight size={14} strokeWidth={1.75} aria-hidden="true" />
              </Link>
            )}
          </div>
        )}
      </div>

      <section className="v-card" aria-label="代理服务列表">
        <DataTable
          loaded={data !== null}
          emptyState={{
            variant: hasActiveFilter ? 'no-results' : 'empty',
            action: hasActiveFilter ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setLens('all');
                  setQuery('');
                  setNode('all');
                  setEngine('all');
                  setRelayFilter('all');
                }}
              >
                <ListFilter size={16} strokeWidth={1.75} aria-hidden="true" />
                清除筛选
              </Button>
            ) : undefined,
          }}
          rows={rows}
          columns={columns}
          rowKey="id"
          caption="代理服务"
          loading={loading}
          emptyMessage={data?.rows.length ? '没有匹配的服务' : '暂无可查看的服务'}
        />
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
        relaysLoaded={data?.relaysLoaded ?? false}
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
        nodes={data?.nodes ?? []}
        nodeEngines={data?.nodeEngines ?? new Map()}
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
