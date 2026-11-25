import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError } from '@/api/client';
import { readStatus, type StatusPage } from '@/api/public-status';
import AppearanceSwitch from '@/components/AppearanceSwitch';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { CountryFlag } from '@/components/country-flag';
import EmptyStates from '@/components/empty-states';
import InitialSkeleton from '@/components/initial-skeleton';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import NodeStatusDetail from './components/NodeStatusDetail';
import PublicNodeSwitcher from './components/PublicNodeSwitcher';
import StatusOverview from './components/StatusOverview';
import { statusNodeKind } from './format';

export default function PublicStatus() {
  const { nodeId } = useParams();
  const [page, setPage] = useState<StatusPage | null>(null);
  const [absent, setAbsent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [generation, setGeneration] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [streamConnected, setStreamConnected] = useState(false);
  const [, error] = useToastFeedback('error', 'status-page');

  // biome-ignore lint/correctness/useExhaustiveDependencies: The refresh counter restarts the request and cancels its predecessor.
  useEffect(() => {
    const c = new AbortController();
    let stream: EventSource | undefined;
    const withdrawn = () => {
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
        setStreamConnected(false);
        stream?.close();
      }
    };
    async function connect() {
      setLoading(true);
      setStreamConnected(false);
      try {
        const v = await readStatus(c.signal);
        if (c.signal.aborted) return;
        apply(v);
        if (!v.live) return;
        stream = new EventSource('/api/v1/status/events');
        stream.onopen = () => setStreamConnected(true);
        stream.addEventListener('withdrawn', withdrawn);
        stream.addEventListener('snapshot', (e: MessageEvent<string>) => {
          setStreamConnected(true);
          try {
            apply(JSON.parse(e.data));
          } catch {
            error('状态数据无法读取，请刷新。');
          }
        });
        stream.onerror = () => {
          setStreamConnected(false);
          error('实时连接中断，正在重新连接。');
        };
      } catch (e) {
        if (c.signal.aborted) return;
        if (e instanceof ApiError && e.status === 404) {
          withdrawn();
          error('');
        } else {
          setAbsent(false);
          error(e instanceof Error ? e.message : '状态页读取失败。');
        }
      } finally {
        if (!c.signal.aborted) setLoading(false);
      }
    }
    void connect();
    const clock = window.setInterval(() => setNow(Date.now()), 5000);
    return () => {
      c.abort();
      stream?.close();
      window.clearInterval(clock);
    };
  }, [generation, error]);

  const selected = nodeId ? page?.nodes.find((n) => n.id === nodeId) : undefined;
  const uniqueTags = selected ? Array.from(new Set(selected.tags.filter(Boolean))) : [];

  return (
    <main className="mx-auto min-h-screen max-w-[112rem] space-y-4 bg-background px-3 py-4 text-foreground sm:px-6 sm:py-6 lg:px-8">
      <header className="space-y-3">
        {nodeId && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2.5">
              <Link
                to="/status"
                className="inline-flex min-h-(--control-height-sm) items-center gap-1.5 rounded-(--radius-control) border-[1px] border-border bg-surface-raised px-3 text-(length:--text-sm) font-medium text-text-secondary transition-colors duration-150 hover:bg-surface-muted hover:text-foreground"
              >
                <ArrowLeft size={15} aria-hidden="true" />
                <span>返回节点状态</span>
              </Link>
              {page && selected && <PublicNodeSwitcher nodes={page.nodes} current={selected} />}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {page && (
                <Badge tone={page.live && streamConnected ? 'success' : 'neutral'} dot>
                  {page.live ? (streamConnected ? '公开推送已连接' : '公开推送未连接') : '静态快照'}
                </Badge>
              )}
              <AppearanceSwitch />
              <Button variant="secondary" onClick={() => setGeneration((v) => v + 1)}>
                <RefreshCw aria-hidden="true" size={16} className="sm:hidden" />
                <span className="sr-only sm:not-sr-only">刷新状态</span>
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            {selected && <CountryFlag code={selected.country} standalone />}
            <h1 className="wrap-anywhere text-xl font-medium">
              {nodeId ? (selected?.alias ?? '节点详情') : '节点状态'}
            </h1>
            {selected && (
              <>
                <Badge tone={selected.online ? 'success' : 'danger'} dot>
                  {selected.online ? '在线' : '离线'}
                </Badge>
                {selected.kind && (
                  <Badge tone="neutral" outline>
                    {statusNodeKind(selected.kind)}
                  </Badge>
                )}
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
              </>
            )}
          </div>

          {!nodeId && (
            <div className="flex flex-wrap items-center gap-2">
              <AppearanceSwitch />
              <Button variant="secondary" onClick={() => setGeneration((v) => v + 1)}>
                <RefreshCw aria-hidden="true" size={16} className="sm:hidden" />
                <span className="sr-only sm:not-sr-only">刷新状态</span>
              </Button>
            </div>
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
            title="状态页未开放"
            description="管理员尚未开放公开状态页，或当前已暂时关闭访问。"
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
