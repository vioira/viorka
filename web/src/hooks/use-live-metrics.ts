import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  type MetricSummary,
  mergeMetricSummaryFrame,
  parseMetricSummaryFrame,
} from '@/api/metric-summary';
import { type LiveSnapshot, mergeMetricFrame, parseMetricFrame } from '@/api/realtime';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { useBrowserSocket, useRealtimeEnabled } from './realtime';

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
  const socket = useBrowserSocket();
  const [items, setItems] = useState<Record<string, T>>({});
  const [state, setState] = useState('connecting');
  const [retry, setRetry] = useState(0);
  const id = useId();
  const { toast, dismiss } = useToastStack();
  const mergedScope = useRef(scope);
  useEffect(() => {
    void retry;
    if (!scope || !enabled) {
      setState('disabled');
      return;
    }
    let active = true;
    const connect = () => {
      socket.setMetrics(document.hidden ? '' : scope);
      setState(document.hidden ? 'paused' : 'connecting');
    };
    const unsubscribe = socket.subscribe((event) => {
      if (!active || document.hidden) return;
      if (event.event === 'closed') {
        setState('closed');
        return;
      }
      if (event.event === 'disconnected') {
        setState('reconnecting');
        return;
      }
      if (event.event === 'metrics_error') {
        setState('closed');
        toast({ id, type: 'error', title: '指标订阅失败', description: '请重新读取指标。' });
        return;
      }
      if (event.event !== 'metrics') return;
      try {
        const frame = parse(JSON.stringify(event.data));
        const sameScope = mergedScope.current === scope;
        mergedScope.current = scope;
        setItems((previous) => merge(sameScope ? previous : {}, frame));
        setState('live');
        dismiss(id);
      } catch {
        setState('closed');
        socket.setMetrics('');
        toast({
          id,
          type: 'error',
          title: '实时指标格式无效',
          description: '已有数据保留，请重新连接。',
        });
      }
    });
    connect();
    document.addEventListener('visibilitychange', connect);
    return () => {
      active = false;
      unsubscribe();
      socket.setMetrics('');
      document.removeEventListener('visibilitychange', connect);
      dismiss(id);
    };
  }, [socket, scope, enabled, retry, id, toast, dismiss, parse, merge]);
  const refresh = useCallback(() => setRetry((n) => n + 1), []);
  return { items, state, refresh };
}
