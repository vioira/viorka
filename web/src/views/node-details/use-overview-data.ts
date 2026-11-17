import { useEffect, useState } from 'react';
import { ApiError } from '@/api/client';
import { type EngineRecord, getEngine, listEngines } from '@/api/engines';
import { getMetricHistory, type MetricHistory } from '@/api/metric-history';
import { useRealtimeConnection, useServerEvent } from '@/hooks/realtime';
import { useToastFeedback } from '@/hooks/use-toast-feedback';

export function useOverviewData(id: string, sampledAt?: string) {
  const [history, setHistory] = useState<MetricHistory>();
  const [engines, setEngines] = useState<EngineRecord[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [enginesLoading, setEnginesLoading] = useState(false);
  const [version, setVersion] = useState(0);
  const [engineVersion, setEngineVersion] = useState(0);
  const { generation, enabled } = useRealtimeConnection();
  const sampleMinute = enabled && sampledAt ? Math.floor(Date.parse(sampledAt) / 60_000) : 0;
  const [, reportHistory] = useToastFeedback('error');
  const [, reportEngines] = useToastFeedback('error');
  useServerEvent(
    (event) => {
      if (
        event.type === 'change' &&
        event.change.kind === 'engines' &&
        (!event.change.node_id || event.change.node_id === id)
      ) {
        setEngineVersion((value) => value + 1);
      }
    },
    id ? [{ kind: 'engines', node_id: id }] : [],
  );
  useEffect(() => {
    void version;
    void generation;
    void sampleMinute;
    if (!id) return;
    const controller = new AbortController();
    setHistoryLoading(true);
    void getMetricHistory(id, '10m', controller.signal, 60)
      .then(
        (data) => {
          if (controller.signal.aborted) return;
          setHistory(data);
          reportHistory('');
        },
        (error: unknown) => {
          if (!controller.signal.aborted)
            reportHistory(
              error instanceof Error ? error.message : '历史指标读取失败，请刷新概览。',
            );
        },
      )
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
      });
    return () => controller.abort();
  }, [id, version, generation, sampleMinute, reportHistory]);
  useEffect(() => {
    void version;
    void engineVersion;
    void generation;
    if (!id) return;
    const controller = new AbortController();
    setEnginesLoading(true);
    void listEngines(id, controller.signal)
      .then((data) =>
        Promise.all(data.items.map((engine) => getEngine(engine.id, controller.signal))),
      )
      .then(
        (data) => {
          if (controller.signal.aborted) return;
          setEngines(data);
          setForbidden(false);
          reportEngines('');
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          if (error instanceof ApiError && error.status === 403) {
            setForbidden(true);
            setEngines(null);
          } else
            reportEngines(error instanceof Error ? error.message : '引擎读取失败，请刷新概览。');
        },
      )
      .finally(() => {
        if (!controller.signal.aborted) setEnginesLoading(false);
      });
    return () => controller.abort();
  }, [id, version, engineVersion, generation, reportEngines]);
  return {
    history,
    engines,
    forbidden,
    loading: historyLoading || enginesLoading,
    refresh: () => setVersion((value) => value + 1),
  };
}
