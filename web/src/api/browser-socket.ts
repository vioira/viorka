import { ApiError, type ApiTransport } from './client';

export type SocketEvent = { event: string; data?: unknown; generation?: number };
type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  cleanup: () => void;
  message: string;
};

/** One authenticated transport per layout. Requests are never replayed after send. */
export class BrowserSocket {
  private socket?: WebSocket;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private ready = false;
  private attempt = 0;
  private serial = 0;
  private generation = 0;
  private scope = '';
  private node = '';
  private engine = '';
  private enabled = true;
  private pending = new Map<string, Pending>();
  private listeners = new Set<(event: SocketEvent) => void>();

  constructor(private csrf: string) {}

  subscribe(listener: (event: SocketEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private emit(event: SocketEvent) {
    for (const listener of this.listeners) listener(event);
  }

  start() {
    this.stopped = false;
    this.connect();
  }
  private connect() {
    if (this.stopped) return;
    const url = new URL('/api/v1/ws', location.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url, 'viorka.browser.v1');
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      socket.send(JSON.stringify({ type: 'hello', csrf: this.csrf, enabled: this.enabled }));
    };
    socket.onmessage = (message) => {
      if (this.socket !== socket) return;
      try {
        const frame = JSON.parse(message.data);
        if (!frame || typeof frame !== 'object') throw new Error();
        if (frame.type === 'response') {
          if (typeof frame.id !== 'string' || !Number.isInteger(frame.status)) throw new Error();
          const request = this.pending.get(frame.id);
          if (!request) return;
          this.pending.delete(frame.id);
          request.cleanup();
          if (frame.status >= 200 && frame.status < 300) request.resolve(frame.data);
          else
            request.reject(
              new ApiError(
                frame.data?.message || '操作失败，请重试。',
                'http',
                frame.status,
                frame.data?.code,
              ),
            );
          return;
        }
        if (frame.type !== 'event' || typeof frame.event !== 'string') throw new Error();
        if (frame.event === 'ready') {
          const first = !this.ready;
          this.ready = true;
          this.attempt = 0;
          if (first) {
            this.sendSubscription();
            for (const pending of this.pending.values()) {
              socket.send(pending.message);
            }
          }
        }
        if (
          (frame.event === 'metrics' || frame.event === 'metrics_error') &&
          frame.generation !== this.generation
        )
          return;
        this.emit(frame);
      } catch {
        this.emit({ event: 'invalid' });
        socket.close(1002, 'invalid message');
      }
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.ready = false;
      for (const request of this.pending.values()) {
        request.cleanup();
        request.reject(new ApiError('连接中断，请重新读取操作结果。', 'network'));
      }
      this.pending.clear();
      this.emit({ event: event.code === 1008 ? 'closed' : 'disconnected' });
      if (!this.stopped && event.code !== 1008) {
        const delay = Math.min(1000 * 2 ** this.attempt++, 15000) * (0.8 + Math.random() * 0.4);
        this.timer = setTimeout(() => this.connect(), delay);
      }
    };
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    const socket = this.socket;
    this.socket = undefined;
    this.ready = false;
    socket?.close();
    for (const request of this.pending.values()) {
      request.cleanup();
      request.reject(new ApiError('连接已关闭。', 'network'));
    }
    this.pending.clear();
  }
  setContext(node: string, enabled: boolean) {
    this.node = node;
    this.enabled = enabled;
    this.sendSubscription();
  }
  setEngine(engine: string) {
    this.engine = engine;
    this.sendSubscription();
  }
  setMetrics(scope: string) {
    this.scope = scope;
    this.generation++;
    this.sendSubscription();
    return this.generation;
  }
  private sendSubscription() {
    if (this.ready)
      this.socket?.send(
        JSON.stringify({
          type: 'subscribe',
          node: this.node,
          engine: this.engine,
          enabled: this.enabled,
          scope: this.scope,
          generation: this.generation,
        }),
      );
  }
  request: ApiTransport = (method, params, { signal, timeoutMs }) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      if (this.stopped || this.pending.size >= 64) {
        reject(new ApiError('连接不可用或操作过多，请稍后重试。', 'network'));
        return;
      }
      const id = `r${++this.serial}`;
      const finish = (error: unknown) => {
        this.pending.get(id)?.cleanup();
        this.pending.delete(id);
        reject(error);
      };
      const abort = () => finish(signal?.reason);
      const timer = setTimeout(
        () => finish(new ApiError('请求超时，请重新读取操作结果。', 'timeout')),
        timeoutMs,
      );
      const pending: Pending = {
        resolve,
        reject,
        cleanup: () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
        },
        message: JSON.stringify({ type: 'request', id, method, params }),
      };
      this.pending.set(id, pending);
      signal?.addEventListener('abort', abort, { once: true });
      if (this.ready) this.socket?.send(pending.message);
    });
}
