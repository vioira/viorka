import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { parseResourceChange, type ResourceChange } from '@/api/realtime';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';

export type ServerEvent =
  | { type: 'ready' }
  | { type: 'change'; change: ResourceChange }
  | { type: 'snapshot' | 'notifications'; data: string };
type Listener = (event: ServerEvent) => void;
const RealtimeContext = createContext({
  enabled: false,
  subscribe:
    (_listener: Listener): (() => void) =>
    () => {},
});

export function RealtimeProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const listeners = useRef(new Set<Listener>());
  const { toast, dismiss } = useToastStack();
  const value = useMemo(
    () => ({
      enabled,
      subscribe(listener: Listener) {
        listeners.current.add(listener);
        return () => {
          listeners.current.delete(listener);
        };
      },
    }),
    [enabled],
  );
  useEffect(() => {
    if (!enabled) return;
    const stream = new EventSource('/api/v1/events');
    const emit = (event: ServerEvent) => {
      for (const listener of listeners.current) listener(event);
    };
    const fail = (message: string) =>
      toast({
        id: 'realtime-connection',
        type: 'error',
        title: '实时更新未同步',
        description: message,
      });
    stream.addEventListener('ready', () => {
      dismiss('realtime-connection');
      emit({ type: 'ready' });
    });
    stream.addEventListener('change', (event) => {
      try {
        emit({ type: 'change', change: parseResourceChange(event.data) });
      } catch {
        fail('实时事件格式无效，请刷新页面重新同步。');
        stream.close();
      }
    });
    for (const type of ['snapshot', 'notifications'] as const)
      stream.addEventListener(type, (event) => emit({ type, data: event.data }));
    stream.addEventListener('closed', () => {
      stream.close();
      fail('实时推送已关闭或登录已失效，请刷新页面。');
    });
    stream.onerror = () =>
      fail(
        stream.readyState === EventSource.CLOSED
          ? '实时连接已关闭，请刷新页面重试。'
          : '连接中断，正在重新连接。已有数据保留。',
      );
    return () => {
      stream.close();
      dismiss('realtime-connection');
    };
  }, [enabled, toast, dismiss]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}
export function useServerEvent(listener: Listener) {
  const { subscribe } = useContext(RealtimeContext);
  const latest = useRef(listener);
  useEffect(() => {
    latest.current = listener;
  });
  useEffect(() => subscribe((event) => latest.current(event)), [subscribe]);
}
export function useChangeVersion(kind: string, node?: string) {
  const [version, setVersion] = useState(0);
  useServerEvent((event) => {
    if (
      event.type === 'ready' ||
      (event.type === 'change' &&
        event.change.kind === kind &&
        (!node || !event.change.node_id || event.change.node_id === node))
    )
      setVersion((n) => n + 1);
  });
  return version;
}
export function useRealtimeEnabled() {
  return useContext(RealtimeContext).enabled;
}
