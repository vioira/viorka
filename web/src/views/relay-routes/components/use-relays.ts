import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/api/client';
import { listRelays, type RelayList } from '@/api/relays';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { useServerEvent } from '@/hooks/realtime';

export {
  endpointText,
  localTime,
  needsRelayPublication,
  reasonLabel,
  relayStatusLabel,
} from '@/components/proxy/relay-meta';

export function useRelays(engine?: string, service?: string, enabled = true, entry?: string) {
  const [data, setData] = useState<RelayList | null>(null);
  const [busy, setBusy] = useState(false);
  const req = useRef<AbortController | null>(null);
  const { toast } = useToastStack();

  const reload = useCallback(async () => {
    if (!enabled) return;
    req.current?.abort();
    const controller = new AbortController();
    req.current = controller;
    setBusy(true);
    try {
      const page = await listRelays(engine, service, undefined, controller.signal, entry);
      while (page.next_cursor) {
        const next = await listRelays(engine, service, page.next_cursor, controller.signal, entry);
        page.items.push(...next.items);
        page.next_cursor = next.next_cursor;
      }
      if (!controller.signal.aborted) setData(page);
    } catch (err) {
      if (!controller.signal.aborted) {
        if (err instanceof ApiError && [401, 403].includes(err.status ?? 0)) setData(null);
        toast({
          id: 'relay-list',
          type: 'error',
          title: '未能读取中转线路',
          description: err instanceof Error ? err.message : undefined,
        });
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }, [engine, service, toast, enabled, entry]);

  useEffect(() => {
    setData(null);
    void reload();
    return () => req.current?.abort();
  }, [reload]);

  useServerEvent(
    (event) => {
      if (
        event.type === 'ready' ||
        (event.type === 'change' && ['engines', 'recovery'].includes(event.change.kind))
      ) {
        void reload();
      }
    },
    enabled
      ? [
          { kind: 'engines', all: true },
          { kind: 'recovery', all: true },
        ]
      : [],
  );

  return { data, busy, reload };
}
