import { useCallback, useEffect, useRef, useState } from 'react';
import { listNodes, NODE_PAGE_SIZE, type NodeRecord } from '@/api/nodes';
import { useToastFeedback } from '@/hooks/use-toast-feedback';

export function useNodes() {
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, report] = useToastFeedback('error');
  const request = useRef<AbortController | null>(null);
  const visibleCount = useRef(NODE_PAGE_SIZE);
  const load = useCallback(
    async (after = '', background = false) => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
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
        visibleCount.current = after
          ? visibleCount.current + items.length
          : Math.max(NODE_PAGE_SIZE, items.length);
        if (controller.signal.aborted) return;
        setNodes((previous) =>
          after
            ? [...new Map([...previous, ...items].map((node) => [node.id, node])).values()]
            : items,
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
    const timer = setInterval(() => {
      if (!request.current && !document.hidden) void load('', true);
    }, 30_000);
    return () => {
      clearInterval(timer);
      request.current?.abort();
    };
  }, [load]);
  return {
    nodes,
    loaded,
    loading,
    hasMore,
    error,
    refresh: () => load(),
    loadMore: () => load(nodes.at(-1)?.id),
  };
}
