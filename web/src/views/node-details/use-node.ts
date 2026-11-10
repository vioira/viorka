import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/api/client';
import { newerMonitoring } from '@/api/monitoring';
import { getNode, type NodeRecord } from '@/api/nodes';
import { useRealtimeConnection, useServerEvent } from '@/hooks/realtime';
import { useLiveMetrics } from '@/hooks/use-live-metrics';
import { useToastFeedback } from '@/hooks/use-toast-feedback';

export function useNode(id: string, view: string) {
  const [node, setNode] = useState<NodeRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [now, setNow] = useState(0);
  const metrics = useLiveMetrics(view ? `node=${encodeURIComponent(id)}&view=${view}` : '');
  const connection = useRealtimeConnection();
  const inFlight = useRef<Promise<void> | null>(null);
  const dirty = useRef(false);
  const patch = useRef<NodeRecord | null>(null);
  const request = useRef<AbortController | null>(null);
  const [, report] = useToastFeedback('error');
  const refresh = useCallback(
    (background = false, invalidate = false): Promise<void> => {
      if (inFlight.current) {
        if (invalidate) dirty.current = true;
        return inFlight.current;
      }
      const controller = new AbortController();
      request.current = controller;
      if (!background) setLoading(true);
      const pending = (async () => {
        try {
          do {
            dirty.current = false;
            patch.current = null;
            const result = await getNode(id, controller.signal);
            if (controller.signal.aborted) return;
            setNode(
              patch.current
                ? { ...(patch.current as NodeRecord), monitoring: result.monitoring }
                : result,
            );
            setMissing(false);
            report('');
          } while (dirty.current && !controller.signal.aborted);
        } catch (cause) {
          if (!controller.signal.aborted) {
            if (cause instanceof ApiError && cause.status === 404) {
              setMissing(true);
              setNode(null);
            }
            report(cause instanceof Error ? cause.message : '无法读取节点详情，请刷新重试。');
          }
        } finally {
          if (request.current === controller) {
            setLoading(false);
            request.current = null;
            inFlight.current = null;
          }
        }
      })();
      inFlight.current = pending;
      return pending;
    },
    [id, report],
  );
  const { initialized, enabled, generation } = connection;
  useEffect(() => {
    if (!initialized) return;
    if (!enabled || generation > 0) {
      void refresh(true, true);
      return;
    }
    const timer = setTimeout(() => void refresh(), 3000);
    return () => clearTimeout(timer);
  }, [initialized, enabled, generation, refresh]);
  useEffect(() => {
    setNow(Date.now());
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      request.current?.abort();
      request.current = null;
      inFlight.current = null;
      clearInterval(clock);
    };
  }, []);
  useServerEvent((event) => {
    if (event.type !== 'change') return;
    if (event.change.kind === 'nodes' && (!event.change.node_id || event.change.node_id === id))
      void refresh(true, true);
    if (event.change.kind === 'node' && event.change.node?.id === id) {
      patch.current = event.change.node;
      const update = event.change.node;
      setNode((previous) => ({ ...update, monitoring: previous?.monitoring }));
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
