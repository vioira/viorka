import { useCallback, useEffect, useRef, useState } from 'react';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';

type Page<T> = { items: T[]; next_cursor: string };

/** Keep paging and cancellation scoped to the current server-side search. */
export function useSubscriptionPages<T>(
  key: string,
  request: (after: string, signal: AbortSignal) => Promise<Page<T>>,
  errorID: string,
  errorTitle: string,
) {
  const { toast } = useToastStack();
  const [result, setResult] = useState<{ key: string; items: T[]; cursor: string }>();
  const [loading, setLoading] = useState(true);
  const abort = useRef<AbortController | null>(null);
  const load = useCallback(
    async (after = '') => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setLoading(true);
      try {
        const page = await request(after, controller.signal);
        if (!controller.signal.aborted) {
          setResult((previous) => ({
            key,
            cursor: page.next_cursor,
            items: after && previous?.key === key ? [...previous.items, ...page.items] : page.items,
          }));
        }
      } catch (error) {
        if (!controller.signal.aborted)
          toast({
            id: errorID,
            type: 'error',
            title: errorTitle,
            description: error instanceof Error ? error.message : '请刷新后重试。',
          });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [key, request, errorID, errorTitle, toast],
  );
  useEffect(() => {
    setLoading(true);
    const timer = window.setTimeout(() => void load(), 180);
    return () => {
      window.clearTimeout(timer);
      abort.current?.abort();
    };
  }, [load]);
  return {
    items: result?.key === key ? result.items : null,
    cursor: result?.key === key ? result.cursor : '',
    loading,
    load,
  };
}
