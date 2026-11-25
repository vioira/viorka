import { useCallback, useEffect, useRef, useState } from 'react';
import { type Catalog, readCatalog } from '@/api/public-status';
import { useServerEvent } from '@/hooks/realtime';
import { useToastFeedback } from '@/hooks/use-toast-feedback';

export function useCategoryCatalog(enabled = true) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [, reportError] = useToastFeedback('error', 'node-category-catalog');
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (background = false): Promise<Catalog | null> => {
      if (!enabled) return null;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      if (!background) setLoading(true);
      try {
        const next = await readCatalog(controller.signal);
        if (!controller.signal.aborted) {
          setCatalog(next);
          reportError('');
        }
        return next;
      } catch (cause) {
        if (!controller.signal.aborted) {
          reportError(cause instanceof Error ? cause.message : '无法读取分类目录，请刷新重试。');
        }
        return null;
      } finally {
        if (controllerRef.current === controller) {
          setLoading(false);
          controllerRef.current = null;
        }
      }
    },
    [enabled, reportError],
  );

  useEffect(() => {
    if (!enabled) return;
    void load();
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [enabled, load]);

  useServerEvent(
    (event) => {
      if (enabled && event.type === 'change' && event.change.kind === 'nodes') {
        void load(true);
      }
    },
    enabled ? [{ kind: 'nodes', all: true }] : [],
  );

  return {
    catalog,
    loading,
    setCatalog,
    refresh: (background = false) => load(background),
  };
}
