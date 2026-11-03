import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/api/client';
import { newerMonitoring } from '@/api/monitoring';
import { getNode, type NodeRecord } from '@/api/nodes';
import { useServerEvent } from '@/hooks/realtime';
import { useLiveMetrics } from '@/hooks/use-live-metrics';
import { useToastFeedback } from '@/hooks/use-toast-feedback';

export function useNode(id: string) {
  const [node, setNode] = useState<NodeRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [now, setNow] = useState(0);
  const metrics = useLiveMetrics(`node=${encodeURIComponent(id)}`);
  const request = useRef<AbortController | null>(null);
  const [, report] = useToastFeedback('error');
  const refresh = useCallback(
    async (background = false) => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      if (!background) setLoading(true);
      try {
        const result = await getNode(id, controller.signal);
        if (controller.signal.aborted) return;
        setNode(result);
        setMissing(false);
        report('');
      } catch (cause) {
        if (!controller.signal.aborted) {
          if (cause instanceof ApiError && cause.status === 404) {
            setMissing(true);
            setNode(null);
          }
          report(cause instanceof Error ? cause.message : '无法读取节点详情，请刷新重试。');
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          request.current = null;
        }
      }
    },
    [id, report],
  );
  useEffect(() => {
    void refresh();
    setNow(Date.now());
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      request.current?.abort();
      clearInterval(clock);
    };
  }, [refresh]);
  useServerEvent((event) => {
    if (
      event.type === 'ready' ||
      (event.type === 'change' && event.change.kind === 'nodes' && event.change.node_id === id)
    ) {
      void refresh(true);
      return;
    }
    if (event.type === 'change' && event.change.kind === 'node' && event.change.node?.id === id) {
      const patch = event.change.node;
      request.current?.abort();
      request.current = null;
      setNode((previous) => ({ ...patch, monitoring: previous?.monitoring }));
      setMissing(false);
      setLoading(false);
    }
  });
  const latest = newerMonitoring(metrics.items[id], node?.monitoring);
  return {
    node: node
      ? {
          ...node,
          monitoring: latest
            ? { ...latest, stale: latest.stale || (!latest.telemetry && node.state !== 'online') }
            : undefined,
        }
      : null,
    metrics,
    loading,
    missing,
    now,
    refresh: (background = false) => {
      if (!background) metrics.refresh();
      return refresh(background);
    },
  };
}
