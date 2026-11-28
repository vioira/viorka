import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getLanding,
  getRelay,
  getRelayEntries,
  type RelayEntry,
  type RelayPath,
  type RelayRoute,
} from '@/api/relays';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';

export function useRelayDraftSources(routeId: string | undefined, engine: string, service: string) {
  const { toast } = useToastStack();
  const request = useRef<AbortController | null>(null);
  const [entries, setEntries] = useState<RelayEntry[] | null>(null);
  const [landing, setLanding] = useState<RelayPath | null>(null);
  const [latest, setLatest] = useState<RelayRoute | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsRetry, setNeedsRetry] = useState(false);

  const reload = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const { signal } = controller;
    setLoading(true);
    setNeedsRetry(false);
    const [nodes, path, route] = await Promise.allSettled([
      getRelayEntries(signal),
      engine && service ? getLanding(engine, service, signal) : null,
      routeId ? getRelay(routeId, signal) : null,
    ]);
    if (signal.aborted) return;
    if (nodes.status === 'fulfilled') setEntries(nodes.value);
    if (route.status === 'fulfilled') setLatest(route.value);
    setLanding(path.status === 'fulfilled' ? path.value : null);
    for (const [result, id, title] of [
      [nodes, 'relay-entries', '未能读取入口节点'],
      [path, 'relay-landing', '无法使用所选落地服务'],
      [route, 'relay-current', '未能读取最新草稿'],
    ] as const) {
      if (result.status === 'rejected') {
        setNeedsRetry(true);
        toast({
          id,
          type: 'error',
          title,
          description: result.reason instanceof Error ? result.reason.message : undefined,
        });
      }
    }
    setLoading(false);
  }, [routeId, engine, service, toast]);
  useEffect(() => {
    void reload();
    return () => request.current?.abort();
  }, [reload]);
  return { entries, landing, latest, loading, needsRetry, reload };
}
