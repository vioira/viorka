import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError } from '@/api/client';
import { readStatus, type StatusPage } from '@/api/public-status';
import AppearanceSwitch from '@/components/AppearanceSwitch';
import { Button } from '@/components/arc/button/button';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import History from './components/History';
import NodeCard from './components/NodeCard';
import StatusOverview from './components/StatusOverview';
import { stamp } from './format';

export default function PublicStatus() {
  const { nodeId } = useParams();
  const [page, setPage] = useState<StatusPage | null>(null),
    [absent, setAbsent] = useState(false),
    [generation, setGeneration] = useState(0),
    [now, setNow] = useState(() => Date.now());
  const [, error] = useToastFeedback('error', 'status-page');
  // biome-ignore lint/correctness/useExhaustiveDependencies: The refresh counter restarts the request and cancels its predecessor.
  useEffect(() => {
    const c = new AbortController();
    let stream: EventSource | undefined;
    const withdrawn = () => {
      setAbsent(true);
      setPage(null);
      stream?.close();
    };
    const apply = (v: StatusPage) => {
      setPage(v);
      setAbsent(false);
      setNow(Date.now());
      error('');
      if (!v.live) stream?.close();
    };
    async function connect() {
      try {
        const v = await readStatus(c.signal);
        if (c.signal.aborted) return;
        apply(v);
        if (!v.live) return;
        stream = new EventSource('/api/v1/status/events');
        stream.addEventListener('withdrawn', withdrawn);
        stream.addEventListener('snapshot', (e: MessageEvent<string>) => {
          try {
            apply(JSON.parse(e.data));
          } catch {
            error('状态数据无法读取，请刷新。');
          }
        });
        stream.onerror = () => error('实时连接中断，正在重新连接。');
      } catch (e) {
        if (c.signal.aborted) return;
        if (e instanceof ApiError && e.status === 404) {
          withdrawn();
          error('');
        } else error(e instanceof Error ? e.message : '状态页读取失败。');
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
  return (
    <main className="mx-auto min-h-screen max-w-[112rem] space-y-3 bg-background px-3 py-3 sm:space-y-4 sm:py-6 text-foreground sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {nodeId && (
            <Link to="/status" className="text-(length:--text-sm) text-text-secondary">
              返回节点状态
            </Link>
          )}
          <h1 className="wrap-anywhere text-xl font-semibold">
            {nodeId ? (selected?.alias ?? '节点详情') : '节点状态'}
          </h1>
          {page && (
            <p className="text-(length:--text-xs) text-text-secondary">更新于 {stamp(page.at)}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AppearanceSwitch />
          <Button variant="secondary" onClick={() => setGeneration((v) => v + 1)}>
            <RefreshCw aria-hidden size={16} className="sm:hidden" />
            <span className="sr-only sm:not-sr-only">刷新状态</span>
          </Button>
        </div>
      </header>
      {page ? (
        nodeId ? (
          selected ? (
            <>
              <div className="max-w-xl">
                <NodeCard node={selected} now={now} link={false} />
              </div>
              <History key={nodeId} id={nodeId} />
            </>
          ) : (
            <p>该节点未公开。</p>
          )
        ) : (
          <StatusOverview page={page} now={now} />
        )
      ) : (
        <p>{absent ? '状态页未开放。' : '节点状态尚未读取。'}</p>
      )}
    </main>
  );
}
