import { useCallback, useEffect, useRef, useState } from 'react';
import { newerMonitoring } from '@/api/monitoring';
import { listNodes, NODE_PAGE_SIZE, type NodeRecord } from '@/api/nodes';
import { useServerEvent } from '@/hooks/realtime';
import { useLiveMetrics } from '@/hooks/use-live-metrics';
import { useToastFeedback } from '@/hooks/use-toast-feedback';

export function useNodes() {
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, report] = useToastFeedback('error');
  const request = useRef<AbortController | null>(null);
  const patches = useRef(new Map<string, NodeRecord>());
  const live = useLiveMetrics(
    nodes.length ? `through=${encodeURIComponent(nodes.at(-1)?.id ?? '')}` : '',
  );
  const visibleCount = useRef(NODE_PAGE_SIZE);
  const load = useCallback(
    async (after = '', background = false) => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      patches.current.clear();
      if (!background) setLoading(true);
      report('');
      try {
        const items = await listNodes(after, controller.signal);
        if (background) {
          while (
            items.length < visibleCount.current &&
            items.length % NODE_PAGE_SIZE === 0 &&
            items.length > 0
          ) {
            const more = await listNodes(items.at(-1)?.id, controller.signal);
            items.push(...more);
            if (more.length < NODE_PAGE_SIZE) break;
          }
        }
        if (controller.signal.aborted) return;
        visibleCount.current = after
          ? visibleCount.current + items.length
          : Math.max(NODE_PAGE_SIZE, items.length);
        const patched = items.map((node) => patches.current.get(node.id) ?? node);
        setNodes((previous) =>
          after
            ? [...new Map([...previous, ...patched].map((node) => [node.id, node])).values()]
            : patched,
        );
        setHasMore(items.length > 0 && items.length % NODE_PAGE_SIZE === 0);
        setLoaded(true);
      } catch (cause) {
        if (!controller.signal.aborted)
          report(cause instanceof Error ? cause.message : '无法读取节点，请刷新重试。');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          request.current = null;
        }
      }
    },
    [report],
  );
  useEffect(() => {
    void load();
    return () => {
      request.current?.abort();
    };
  }, [load]);
  useServerEvent((event) => {
    if (event.type === 'ready' || (event.type === 'change' && event.change.kind === 'nodes')) {
      void load('', true);
      return;
    }
    if (event.type === 'change' && event.change.kind === 'node' && event.change.node) {
      const patch = event.change.node;
      if (request.current && patches.current.size < 1024) patches.current.set(patch.id, patch);
      setNodes((previous) =>
        previous.map((node) =>
          node.id === patch.id ? { ...patch, monitoring: node.monitoring } : node,
        ),
      );
    }
  });
  return {
    nodes: nodes.map((node) => ({
      ...node,
      monitoring: newerMonitoring(live.items[node.id], node.monitoring),
    })),
    loaded,
    loading,
    hasMore,
    error,
    refresh: () => {
      live.refresh();
      return load();
    },
    loadMore: () => load(nodes.at(-1)?.id),
  };
}
