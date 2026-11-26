import { ArrowLeft, Check, Clock, Copy, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ApiError } from '@/api/client';
import { isMetricTrends } from '@/api/metric-trends';
import {
  applyStatusDelta,
  readStatus,
  type StatusDelta,
  type StatusNode,
  type StatusPage,
  statusObservationRange,
} from '@/api/public-status';
import AppearanceSwitch from '@/components/AppearanceSwitch';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { useCopyFeedback } from '@/components/arc/lib/use-copy-feedback';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/arc/popover/popover';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { CountryFlag } from '@/components/country-flag';
import EmptyStates from '@/components/empty-states';
import InitialSkeleton from '@/components/initial-skeleton';
import { NodeOSLabel } from '@/components/node-os-icon';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import NodeStatusDetail from './components/NodeStatusDetail';
import PublicNodeSwitcher from './components/PublicNodeSwitcher';
import StatusOverview from './components/StatusOverview';
import { stamp, statusFastFresh, statusNodeKind, statusRegion, statusRelativeTime } from './format';
import { observeStatusVisibility } from './status-visibility';

function CopyStatusLinkButton() {
  const { state, copy } = useCopyFeedback();
  const { toast } = useToastStack();

  return (
    <Button
      variant="secondary"
      aria-label={state === 'copied' ? '已复制节点链接' : '复制当前节点链接'}
      onClick={async () => {
        const ok = await copy(window.location.href);
        toast({
          id: 'status-link-copy',
          type: ok ? 'success' : 'error',
          title: ok ? '已复制节点状态链接' : '复制失败，请手动复制地址栏链接',
        });
      }}
    >
      {state === 'copied' ? (
        <Check size={16} aria-hidden="true" />
      ) : (
        <Copy size={16} aria-hidden="true" />
      )}
      <span className="sr-only sm:not-sr-only">{state === 'copied' ? '已复制' : '复制链接'}</span>
    </Button>
  );
}

function SampleFreshnessPopover({ node, now }: { node: StatusNode; now: number }) {
  const freshFast = statusFastFresh(node, now) ? node.fast : null;
  const latestSampleAt = freshFast?.sampled_at ?? node.fast?.sampled_at ?? node.full?.sampled_at;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm" aria-label="查看各采集组采样时间明细">
          <Clock size={14} aria-hidden="true" />
          <span className="tabular-nums">
            {latestSampleAt ? `采样 ${statusRelativeTime(latestSampleAt, now)}` : '采样时间'}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-label="采样时间明细">
        <dl className="space-y-2 text-(length:--text-xs) tabular-nums">
          {[
            ['快速采样', freshFast?.sampled_at ?? node.fast?.sampled_at],
            ['磁盘与负载', node.full?.sampled_at],
            ['地址族观测', node.ip_at],
            ['运行时长采样', node.uptime_at],
            ['最后在线', node.last_seen_at],
          ].map(([label, date]) => (
            <div key={label} className="flex items-center justify-between gap-4">
              <dt className="text-text-secondary">{label}</dt>
              <dd>{date ? stamp(date) : '未记录'}</dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}

export default function PublicStatus() {
  const { nodeId } = useParams();
  return <StatusView key={nodeId ?? ''} nodeId={nodeId} />;
}

function StatusView({ nodeId }: { nodeId?: string }) {
  const [params] = useSearchParams();
  const summary = Boolean(nodeId && statusObservationRange(params.get('range')) !== 'live');
  const [page, setPage] = useState<StatusPage | null>(null);
  const [absent, setAbsent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [generation, setGeneration] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [streamConnected, setStreamConnected] = useState(false);
  const [, error] = useToastFeedback('error', 'status-page');

  // biome-ignore lint/correctness/useExhaustiveDependencies: The refresh counter restarts the request and cancels its predecessor.
  useEffect(() => {
    let terminal = false;
    return observeStatusVisibility(() => {
      setNow(Date.now());
      const clock = window.setInterval(() => setNow(Date.now()), 5000);
      if (terminal) return () => window.clearInterval(clock);
      const c = new AbortController();
      let stream: EventSource | undefined;
      const withdrawn = () => {
        terminal = true;
        setAbsent(true);
        setPage(null);
        setStreamConnected(false);
        stream?.close();
      };
      const apply = (v: StatusPage) => {
        setPage(v);
        setAbsent(false);
        setNow(Date.now());
        error('');
        if (!v.live) {
          terminal = true;
          setStreamConnected(false);
          stream?.close();
        }
      };
      setLoading(true);
      setStreamConnected(false);
      let received = false;
      let fallbackRequested = false;
      stream = new EventSource(
        nodeId
          ? `/api/v1/status/events?${new URLSearchParams({ node: nodeId, ...(summary ? { view: 'summary' } : {}) })}`
          : '/api/v1/status/events',
      );
      stream.addEventListener('withdrawn', () => {
        if (c.signal.aborted) return;
        received = true;
        withdrawn();
        setLoading(false);
        error('');
      });
      stream.addEventListener('snapshot', (e: MessageEvent<string>) => {
        try {
          if (c.signal.aborted) return;
          const snapshot: StatusPage = JSON.parse(e.data);
          if (
            nodeId &&
            (snapshot.nodes.length !== 1 ||
              snapshot.nodes[0].id !== nodeId ||
              (snapshot.nodes[0].metric_trends && !isMetricTrends(snapshot.nodes[0].metric_trends)))
          )
            throw new Error('invalid snapshot');
          received = true;
          apply(snapshot);
          setStreamConnected(snapshot.live);
          setLoading(false);
        } catch {
          error('状态数据无法读取，请刷新。');
        }
      });
      stream.addEventListener('delta', (e: MessageEvent<string>) => {
        try {
          if (c.signal.aborted) return;
          const delta: StatusDelta = JSON.parse(e.data);
          if (
            nodeId &&
            Object.entries(delta.nodes ?? {}).some(
              ([id, patch]) =>
                id !== nodeId || (patch.metric_trends && !isMetricTrends(patch.metric_trends)),
            )
          )
            throw new Error('invalid delta');
          setPage((previous) => previous && applyStatusDelta(previous, delta));
          setNow(Date.now());
        } catch {
          error('状态数据无法读取，请刷新。');
        }
      });
      stream.onerror = async () => {
        if (c.signal.aborted) return;
        setStreamConnected(false);
        const reconnecting = stream?.readyState !== EventSource.CLOSED;
        error(reconnecting ? '实时连接中断，正在重新连接。' : '实时连接已关闭，请刷新状态。');
        if (received || fallbackRequested) return;
        fallbackRequested = true;
        try {
          const snapshot = await readStatus(c.signal, nodeId);
          if (!received && !c.signal.aborted) {
            setPage(snapshot);
            setAbsent(false);
            if (!snapshot.live) apply(snapshot);
          }
        } catch (e) {
          if (received || c.signal.aborted) return;
          if (e instanceof ApiError && e.status === 404) {
            withdrawn();
            error('');
          } else {
            error(e instanceof Error ? e.message : '状态页读取失败。');
          }
        } finally {
          if (!c.signal.aborted) setLoading(false);
        }
      };
      return () => {
        setStreamConnected(false);
        c.abort();
        stream?.close();
        window.clearInterval(clock);
      };
    });
  }, [generation, error, nodeId, summary]);

  const selected = nodeId ? page?.nodes.find((n) => n.id === nodeId) : undefined;
  const uniqueTags = selected ? Array.from(new Set(selected.tags.filter(Boolean))) : [];

  return (
    <main
      className={`mx-auto min-h-screen ${nodeId ? 'max-w-[88rem]' : 'max-w-[112rem]'} space-y-5 bg-background px-3 py-4 text-foreground sm:px-6 sm:py-6 lg:px-8`}
    >
      <header className="space-y-3">
        {nodeId && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2.5">
              <Link
                to="/status"
                className="inline-flex min-h-(--control-height-md) items-center gap-1.5 rounded-(--radius-control) border-[1px] border-border bg-surface-raised px-3 text-(length:--text-sm) font-medium text-text-secondary transition-colors duration-150 hover:bg-surface-muted hover:text-foreground"
              >
                <ArrowLeft size={15} aria-hidden="true" />
                <span>全部节点</span>
              </Link>
              {page && selected && <PublicNodeSwitcher key={selected.id} current={selected} />}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {page && (
                <Badge tone={page.live && streamConnected ? 'success' : 'neutral'} dot>
                  {page.live ? (streamConnected ? '实时推送已连接' : '实时推送未连接') : '静态快照'}
                </Badge>
              )}
              {selected && <CopyStatusLinkButton />}
              <AppearanceSwitch />
              <Button variant="secondary" onClick={() => setGeneration((v) => v + 1)}>
                <RefreshCw aria-hidden="true" size={16} className="sm:hidden" />
                <span className="sr-only sm:not-sr-only">刷新状态</span>
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2.5">
              {selected && <CountryFlag code={selected.country} standalone />}
              <h1 className="wrap-anywhere text-(length:--text-2xl) font-medium tracking-tight">
                {nodeId ? (selected?.alias ?? '节点详情') : '节点状态'}
              </h1>
              {selected && (
                <Badge tone={selected.online ? 'success' : 'danger'} dot>
                  {selected.online ? '在线' : '离线'}
                </Badge>
              )}
            </div>

            {selected && (
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone="neutral" outline>
                  {statusRegion(selected)}
                </Badge>
                {selected.kind && (
                  <Badge tone="neutral" outline>
                    {statusNodeKind(selected.kind)}
                  </Badge>
                )}
                {selected.ipv4 && (
                  <Badge
                    tone="success"
                    outline
                    size="sm"
                    title={selected.ip_at ? stamp(selected.ip_at) : undefined}
                  >
                    IPv4
                  </Badge>
                )}
                {selected.ipv6 && (
                  <Badge
                    tone="success"
                    outline
                    size="sm"
                    title={selected.ip_at ? stamp(selected.ip_at) : undefined}
                  >
                    IPv6
                  </Badge>
                )}
                <Badge tone="neutral" outline>
                  <span className="inline-flex items-center gap-1.5">
                    <NodeOSLabel os={selected.os} />
                    {selected.arch && <span>({selected.arch})</span>}
                  </span>
                </Badge>
                {selected.group && (
                  <Badge className="max-w-full" title={selected.group}>
                    {selected.group}
                  </Badge>
                )}
                {uniqueTags.map((label) => (
                  <Badge key={label} outline className="max-w-full" title={label}>
                    <span className="whitespace-normal wrap-anywhere">{label}</span>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {selected ? (
            <SampleFreshnessPopover node={selected} now={now} />
          ) : (
            !nodeId && (
              <div className="flex flex-wrap items-center gap-2">
                <AppearanceSwitch />
                <Button variant="secondary" onClick={() => setGeneration((v) => v + 1)}>
                  <RefreshCw aria-hidden="true" size={16} className="sm:hidden" />
                  <span className="sr-only sm:not-sr-only">刷新状态</span>
                </Button>
              </div>
            )
          )}
        </div>
      </header>

      {page ? (
        nodeId ? (
          selected ? (
            <NodeStatusDetail
              key={selected.id}
              node={selected}
              rates={page.rates}
              streamState={!page.live ? 'disabled' : streamConnected ? 'connected' : 'disconnected'}
              snapshotAt={page.at}
              now={now}
            />
          ) : (
            <section className="v-card">
              <EmptyStates
                variant="not-found"
                title="该节点未公开"
                description="节点不存在或已从公开状态页撤回。"
                action={
                  <Link
                    to="/status"
                    className="inline-flex min-h-(--control-height-md) items-center rounded-(--radius-control) border-[1px] border-border bg-surface-raised px-4 text-(length:--text-sm) font-medium text-foreground hover:bg-surface-muted"
                  >
                    返回节点状态
                  </Link>
                }
              />
            </section>
          )
        ) : (
          <StatusOverview page={page} now={now} />
        )
      ) : absent ? (
        <section className="v-card">
          <EmptyStates
            variant="not-found"
            title={nodeId ? '该节点未公开' : '状态页未开放'}
            description={
              nodeId
                ? '节点不存在或已从公开状态页撤回。'
                : '管理员尚未开放公开状态页，或当前已暂时关闭访问。'
            }
          />
        </section>
      ) : loading ? (
        <section className="v-card" aria-busy="true">
          <InitialSkeleton label="正在读取节点状态" lines={5} />
        </section>
      ) : (
        <section className="v-card">
          <EmptyStates variant="unknown" title="节点状态尚未读取" />
        </section>
      )}
    </main>
  );
}
