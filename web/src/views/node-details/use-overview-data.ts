import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@/api/client';
import { type EngineSummary, listEngines } from '@/api/engines';
import { parseHistoryResponse } from '@/api/history-wire';
import type { MetricHistory } from '@/api/metric-history';
import { useRealtimeConnection, useServerEvent } from '@/hooks/realtime';
import { useBrowserView } from '@/hooks/use-browser-view';
import { useToastFeedback } from '@/hooks/use-toast-feedback';

function parseMinutes(value: unknown, previous?: MetricHistory): MetricHistory {
  const data = parseHistoryResponse(value);
  if (data?.period_seconds !== 60) throw new Error('历史指标格式无效，请刷新概览。');
  const frame = value as { reset: boolean; removed: number[] };
  if (
    typeof frame.reset !== 'boolean' ||
    !Array.isArray(frame.removed) ||
    frame.removed.length > 10 ||
    !frame.removed.every(Number.isSafeInteger) ||
    (!frame.reset && !previous)
  )
    throw new Error('分钟历史需要重新同步，请刷新概览。');
  const rows = new Map(
    (frame.reset ? [] : previous?.points)?.map((p) => [Date.parse(p.at) / 1000, p]),
  );
  for (const start of frame.removed) rows.delete(start);
  for (const p of data.points) rows.set(Date.parse(p.at) / 1000, p);
  return {
    ...data,
    points: [...rows.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)),
  };
}
export function useOverviewData(id: string) {
  const [history, setHistory] = useState<MetricHistory>();
  const [engines, setEngines] = useState<EngineSummary[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [enginesLoading, setEnginesLoading] = useState(false);
  const [version, setVersion] = useState(0);
  const [engineVersion, setEngineVersion] = useState(0);
  const { generation } = useRealtimeConnection();
  const [, report] = useToastFeedback('error');
  const patches = useRef(new Map<string, EngineSummary>());
  const { loading } = useBrowserView(
    'minute_history',
    id ? { node: id, range: '10m' } : null,
    version,
    parseMinutes,
    setHistory,
    true,
  );
  useServerEvent(
    (event) => {
      if (
        event.type !== 'change' ||
        event.change.kind !== 'engines' ||
        (event.change.node_id && event.change.node_id !== id)
      )
        return;
      const item = event.change.engine;
      if (!item) {
        setEngineVersion((n) => n + 1);
        return;
      }
      patches.current.set(item.id, item);
      setEngines((old) => old && [...old.filter((e) => e.id !== item.id), item]);
    },
    id ? [{ kind: 'engines', node_id: id }] : [],
  );
  useEffect(() => {
    void version;
    void engineVersion;
    void generation;
    if (!id) return;
    const controller = new AbortController();
    patches.current.clear();
    setEnginesLoading(true);
    listEngines(id, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        const rows = new Map(data.items.map((e) => [e.id, e]));
        for (const [key, e] of patches.current) rows.set(key, e);
        setEngines([...rows.values()]);
        setForbidden(false);
        report('');
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 403) {
          setForbidden(true);
          setEngines(null);
        } else report(error instanceof Error ? error.message : '引擎读取失败，请刷新概览。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setEnginesLoading(false);
      });
    return () => controller.abort();
  }, [id, generation, engineVersion, version, report]);
  return {
    history,
    engines,
    forbidden,
    loading: loading || enginesLoading,
    refresh: () => setVersion((n) => n + 1),
  };
}
