import { useCallback, useEffect, useRef, useState } from 'react';
import { listEngines } from '@/api/engines';
import { newerMonitoring } from '@/api/monitoring';
import { listAllNodes, type NodeRecord } from '@/api/nodes';
import { useServerEvent } from '@/hooks/realtime';
import { useLiveMetrics } from '@/hooks/use-live-metrics';
import { useToastFeedback } from '@/hooks/use-toast-feedback';

export type ListedNode = NodeRecord & { engines?: string[] };

export function useNodes() {
  const [nodes, setNodes] = useState<ListedNode[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, report] = useToastFeedback('error');
  const request = useRef<AbortController | null>(null);
  const patches = useRef(new Map<string, NodeRecord>());
  const live = useLiveMetrics(
    nodes.length ? `through=${encodeURIComponent(nodes.at(-1)?.id ?? '')}` : '',
  );
  const load = useCallback(
    async (background = false) => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      patches.current.clear();
      if (!background) setLoading(true);
      report('');
      try {
        const items = await listAllNodes(controller.signal);
        if (controller.signal.aborted) return;
        const patched = items.map((node) => patches.current.get(node.id) ?? node);
        setNodes((previous) => {
          const engines = new Map(previous.map((node) => [node.id, node.engines]));
          return patched.map((node) => ({ ...node, engines: engines.get(node.id) }));
        });
        setLoaded(true);
        // Bound requests even when the inventory spans many pages.
        const queue = [...items];
        let engineFailure = false;
        await Promise.all(
          Array.from({ length: Math.min(4, queue.length) }, async () => {
            while (!controller.signal.aborted) {
              const node = queue.shift();
              if (!node) return;
              try {
                const result = await listEngines(encodeURIComponent(node.id), controller.signal);
                if (controller.signal.aborted) return;
                const engines = result.items
                  .filter((engine) => engine.status !== 'not_installed')
                  .map(
                    (engine) =>
                      `${({ xray: 'Xray', realm: 'Realm' } as Record<string, string>)[engine.name] ?? engine.name}${engine.version ? ` ${engine.version}` : ''}`,
                  );
                setNodes((previous) =>
                  previous.map((item) => (item.id === node.id ? { ...item, engines } : item)),
                );
              } catch {
                if (!controller.signal.aborted) engineFailure = true;
              }
            }
          }),
        );
        if (engineFailure && !controller.signal.aborted)
          report('部分节点引擎未能读取，已保留已有数据，请刷新节点重试。');
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
      void load(true);
      return;
    }
    if (event.type === 'change' && event.change.kind === 'node' && event.change.node) {
      const patch = event.change.node;
      if (request.current && patches.current.size < 1024) patches.current.set(patch.id, patch);
      setNodes((previous) =>
        previous.map((node) =>
          node.id === patch.id
            ? { ...patch, engines: node.engines, monitoring: node.monitoring }
            : node,
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
    error,
    refresh: () => {
      live.refresh();
      return load();
    },
  };
}
