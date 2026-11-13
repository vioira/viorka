import { useCallback, useEffect, useRef, useState } from 'react';
import type { MetricSummary } from '@/api/metric-summary';
import { listAllNodes, listNodes, type NodeRecord } from '@/api/nodes';
import { useRealtimeConnection, useServerEvent } from '@/hooks/realtime';
import { useListMetrics } from '@/hooks/use-live-metrics';
import { useToastFeedback } from '@/hooks/use-toast-feedback';

export type ListedNode = NodeRecord & { metricSummary?: MetricSummary };

export function useNodes(limit?: number, notificationId?: string) {
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, report] = useToastFeedback('error', notificationId);
  const connection = useRealtimeConnection();
  const request = useRef<AbortController | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const dirty = useRef(false);
  const patches = useRef(new Map<string, NodeRecord>());
  const live = useListMetrics(
    nodes.length ? `through=${encodeURIComponent(nodes.at(-1)?.id ?? '')}` : '',
  );
  const load = useCallback(
    (background = false, invalidate = false): Promise<void> => {
      if (inFlight.current) {
        if (invalidate) dirty.current = true;
        return inFlight.current;
      }
      const controller = new AbortController();
      request.current = controller;
      if (!background) setLoading(true);
      report('');
      const pending = (async () => {
        try {
          do {
            dirty.current = false;
            patches.current.clear();
            const items = await (limit
              ? listNodes('', controller.signal, limit)
              : listAllNodes(controller.signal));
            if (controller.signal.aborted) return;
            setNodes(
              items.map((node) => {
                const patch = patches.current.get(node.id);
                return patch ? { ...patch, monitoring: node.monitoring } : node;
              }),
            );
            setLoaded(true);
          } while (dirty.current && !controller.signal.aborted);
        } catch (cause) {
          if (!controller.signal.aborted)
            report(cause instanceof Error ? cause.message : '无法读取节点，请刷新重试。');
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
    [report, limit],
  );
  const { enabled, initialized, generation } = connection;
  useEffect(() => {
    if (!initialized) return;
    if (!enabled || generation > 0) {
      void load(true, true);
      return;
    }
    // A failed stream must not block the initial REST inventory indefinitely.
    const timer = setTimeout(() => void load(), 3000);
    return () => clearTimeout(timer);
  }, [enabled, initialized, generation, load]);
  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
      inFlight.current = null;
    },
    [],
  );
  useServerEvent(
    (event) => {
      if (event.type !== 'change') return;
      if (event.change.kind === 'nodes') {
        void load(true, true);
      } else if (event.change.kind === 'node' && event.change.node) {
        const patch = event.change.node;
        if (request.current && patches.current.size < 1024) patches.current.set(patch.id, patch);
        setNodes((previous) =>
          previous.map((node) =>
            node.id === patch.id ? { ...patch, monitoring: node.monitoring } : node,
          ),
        );
      }
    },
    [
      { kind: 'nodes', all: true },
      ...(nodes.length ? [{ kind: 'node', through: nodes.at(-1)?.id }] : []),
    ],
  );
  return {
    nodes: nodes.map((node) => {
      const summary = live.items[node.id];
      return {
        ...node,
        metricSummary:
          summary &&
          (!node.monitoring ||
            Date.parse(summary.received_at) >= Date.parse(node.monitoring.received_at))
            ? summary
            : undefined,
      };
    }),
    loaded,
    loading,
    error,
    refresh: () => {
      live.refresh();
      return load();
    },
    created: () => (connection.connected ? Promise.resolve() : load()),
  };
}
