import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/api/client';
import { getNode, type NodeRecord } from '@/api/nodes';
import { useToastFeedback } from '@/hooks/use-toast-feedback';

export function useNode(id: string) {
  const [node, setNode] = useState<NodeRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [now, setNow] = useState(0);
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
    const timer = setInterval(() => {
      if (!request.current && !document.hidden) void refresh(true);
    }, 5000);
    return () => {
      request.current?.abort();
      clearInterval(timer);
      clearInterval(clock);
    };
  }, [refresh]);
  return { node, loading, missing, now, refresh };
}
