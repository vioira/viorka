import { useCallback, useEffect, useId, useState } from 'react';
import {
  type MetricSummary,
  mergeMetricSummaryFrame,
  parseMetricSummaryFrame,
} from '@/api/metric-summary';
import { type LiveSnapshot, mergeMetricFrame, parseMetricFrame } from '@/api/realtime';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { useRealtimeEnabled } from './realtime';

export function useLiveMetrics(scope: string) {
  return useMetricStream(scope, parseMetricFrame, mergeMetricFrame);
}
export function useListMetrics(scope: string) {
  return useMetricStream(scope, parseMetricSummaryFrame, mergeMetricSummaryFrame);
}
function useMetricStream<T extends LiveSnapshot | MetricSummary, F>(
  scope: string,
  parse: (raw: string) => F,
  merge: (current: Record<string, T>, frame: F) => Record<string, T>,
) {
  const enabled = useRealtimeEnabled();
  const [items, setItems] = useState<Record<string, T>>({});
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
          const frame = parse(event.data);
          setItems((previous) => merge(previous, frame));
          setState('live');
          dismiss(id);
        } catch {
          stream = undefined;
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
        if (source !== stream) return;
        stream = undefined;
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
        const closed = source.readyState === EventSource.CLOSED;
        if (closed) {
          stream = undefined;
          source.close();
        }
        setState(closed ? 'closed' : 'reconnecting');
        toast({
          id,
          type: 'error',
          title: '实时指标暂未同步',
          description: closed ? '请重新连接或刷新页面。' : '正在重新连接，已有采样保留。',
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
  }, [scope, enabled, retry, id, toast, dismiss, parse, merge]);
  const refresh = useCallback(() => setRetry((n) => n + 1), []);
  return { items, state, refresh };
}
