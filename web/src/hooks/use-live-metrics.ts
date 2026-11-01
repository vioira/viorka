import { useCallback, useEffect, useId, useState } from 'react';
import { type LiveSnapshot, mergeMetricFrame, parseMetricFrame } from '@/api/realtime';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { useRealtimeEnabled } from './realtime';

export function useLiveMetrics(scope: string) {
  const enabled = useRealtimeEnabled();
  const [items, setItems] = useState<Record<string, LiveSnapshot>>({});
  const [state, setState] = useState('connecting');
  const [retry, setRetry] = useState(0);
  const id = useId();
  const { toast, dismiss } = useToastStack();
  useEffect(() => {
    void retry;
    if (!scope || !enabled) {
      setState('disabled');
      return;
    }
    let stream: EventSource | undefined;
    function connect() {
      stream?.close();
      stream = undefined;
      if (document.hidden) {
        setState('paused');
        return;
      }
      setState('connecting');
      const source = new EventSource(`/api/v1/metrics/events?${scope}`);
      stream = source;
      source.addEventListener('metrics', (event) => {
        if (source !== stream) return;
        try {
          const frame = parseMetricFrame(event.data);
          setItems((previous) => mergeMetricFrame(previous, frame));
          setState('live');
          dismiss(id);
        } catch {
          source.close();
          setState('closed');
          toast({
            id,
            type: 'error',
            title: '实时指标格式无效',
            description: '已有数据保留，请重新连接。',
          });
        }
      });
      source.addEventListener('closed', () => {
        source.close();
        setState('closed');
        toast({
          id,
          type: 'error',
          title: '实时指标连接已关闭',
          description: '请检查登录和实时推送设置。',
        });
      });
      source.onerror = () => {
        if (source !== stream) return;
        setState(source.readyState === EventSource.CLOSED ? 'closed' : 'reconnecting');
        toast({
          id,
          type: 'error',
          title: '实时指标暂未同步',
          description:
            source.readyState === EventSource.CLOSED
              ? '请重新连接或刷新页面。'
              : '正在重新连接，已有采样保留。',
        });
      };
    }
    connect();
    document.addEventListener('visibilitychange', connect);
    return () => {
      stream?.close();
      stream = undefined;
      document.removeEventListener('visibilitychange', connect);
      dismiss(id);
    };
  }, [scope, enabled, retry, id, toast, dismiss]);
  const refresh = useCallback(() => setRetry((n) => n + 1), []);
  return { items, state, refresh };
}
