import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { BrowserSocket } from '@/api/browser-socket';
import { installApiTransport } from '@/api/client';
import { parseResourceChange, type ResourceChange } from '@/api/realtime';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';

export type ServerEvent =
  | { type: 'ready' | 'disconnected' }
  | { type: 'change'; change: ResourceChange }
  | { type: 'snapshot' | 'notifications'; data: string };
const SocketContext = createContext<BrowserSocket | null>(null);
export function useBrowserSocket() {
  const socket = useContext(SocketContext);
  if (!socket) throw new Error('缺少实时连接');
  return socket;
}
type Listener = (event: ServerEvent) => void;
const RealtimeContext = createContext({
  enabled: false,
  initialized: false,
  generation: 0,
  connected: false,
  subscribe:
    (_listener: Listener): (() => void) =>
    () => {},
});

export function RealtimeProvider({
  enabled,
  csrf,
  node = '',
  children,
}: {
  enabled: boolean | null;
  csrf: string;
  node?: string;
  children: ReactNode;
}) {
  const socket = useMemo(() => new BrowserSocket(csrf), [csrf]);
  const [generation, setGeneration] = useState(0);
  const [serverEnabled, setServerEnabled] = useState(true);
  const [connected, setConnected] = useState(false);
  const listeners = useRef(new Set<Listener>());
  const { toast, dismiss } = useToastStack();
  const value = useMemo(
    () => ({
      enabled: enabled === true && serverEnabled,
      initialized: enabled !== null,
      generation,
      connected,
      subscribe(listener: Listener) {
        listeners.current.add(listener);
        return () => {
          listeners.current.delete(listener);
        };
      },
    }),
    [enabled, serverEnabled, generation, connected],
  );
  useLayoutEffect(() => {
    const uninstall = installApiTransport(socket.request);
    socket.start();
    return () => {
      uninstall();
      socket.stop();
    };
  }, [socket]);
  useEffect(() => {
    socket.setContext(node, enabled === true);
  }, [socket, node, enabled]);
  useEffect(() => {
    const emit = (event: ServerEvent) => {
      for (const listener of listeners.current) listener(event);
    };
    return socket.subscribe((frame) => {
      if (frame.event === 'ready') {
        dismiss('realtime-connection');
        setConnected(true);
        setGeneration((n) => n + 1);
        emit({ type: 'ready' });
      } else if (frame.event === 'change') {
        try {
          emit({ type: 'change', change: parseResourceChange(JSON.stringify(frame.data)) });
        } catch {
          toast({
            id: 'realtime-connection',
            type: 'error',
            title: '实时数据格式无效',
            description: '请刷新页面重新同步。',
          });
        }
      } else if (frame.event === 'snapshot' || frame.event === 'notifications') {
        emit({ type: frame.event, data: JSON.stringify(frame.data) });
      } else if (frame.event === 'updates') {
        setServerEnabled(frame.data === true);
      } else if (
        frame.event === 'disconnected' ||
        frame.event === 'invalid' ||
        frame.event === 'closed'
      ) {
        setConnected(false);
        emit({ type: 'disconnected' });
        toast({
          id: 'realtime-connection',
          type: 'error',
          title: '实时连接中断',
          description:
            frame.event === 'closed' ? '会话已失效，请重新登录。' : '正在重新连接，已有数据保留。',
        });
      }
    });
  }, [socket, toast, dismiss]);
  return (
    <SocketContext.Provider value={socket}>
      <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
    </SocketContext.Provider>
  );
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

export function useRealtimeConnection() {
  const { enabled, initialized, generation, connected } = useContext(RealtimeContext);
  return { enabled, initialized, generation, connected };
}
