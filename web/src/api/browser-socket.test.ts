import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserSocket } from './browser-socket';

class Socket {
  static all: Socket[] = [];
  sent: Record<string, unknown>[] = [];
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: (event: { code: number }) => void;
  constructor() {
    Socket.all.push(this);
  }
  send(raw: string) {
    this.sent.push(JSON.parse(raw));
  }
  close(code = 1000) {
    this.onclose?.({ code });
  }
  frame(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
  ready() {
    this.onopen?.();
    this.frame({ type: 'event', event: 'ready' });
  }
}
let client: BrowserSocket;
beforeEach(() => {
  vi.useFakeTimers();
  Socket.all = [];
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('location', { origin: 'https://panel.example' });
  client = new BrowserSocket('csrf');
  client.start();
});
afterEach(() => {
  client.stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('browser multiplexed transport', () => {
  it('switches subscriptions on one socket and rejects stale metric frames', () => {
    const listener = vi.fn();
    client.subscribe(listener);
    const socket = Socket.all[0];
    socket.ready();
    client.setContext('node', true);
    const old = client.setMetrics('node=node&view=overview');
    const current = client.setMetrics('node=node&view=live');
    socket.frame({ type: 'event', event: 'metrics', generation: old, data: {} });
    socket.frame({ type: 'event', event: 'metrics', generation: current, data: {} });
    expect(Socket.all).toHaveLength(1);
    expect(listener.mock.calls.filter(([event]) => event.event === 'metrics')).toHaveLength(1);
  });
  it('correlates concurrent results and preserves server error codes', async () => {
    const socket = Socket.all[0];
    socket.ready();
    const a = client.request('getNode', { id: 'n', query: {} }, { timeoutMs: 1000 });
    const b = client.request('saveEngineDraft', { id: 'e', query: {} }, { timeoutMs: 1000 });
    const failed = expect(b).rejects.toMatchObject({ status: 409, code: 'engine_conflict' });
    socket.frame({
      type: 'response',
      id: 'r2',
      status: 409,
      data: { code: 'engine_conflict', message: '版本冲突' },
    });
    socket.frame({ type: 'response', id: 'r1', status: 200, data: { id: 'n' } });
    expect(await a).toEqual({ id: 'n' });
    await failed;
  });
  it('does not replay submitted mutations after reconnect', async () => {
    const socket = Socket.all[0];
    socket.ready();
    const request = client.request(
      'engineAction',
      { id: 'e', query: {}, body: { idempotency_key: 'k' } },
      { timeoutMs: 12000 },
    );
    const failed = expect(request).rejects.toMatchObject({ kind: 'network' });
    socket.close(1006);
    await failed;
    await vi.advanceTimersByTimeAsync(2000);
    Socket.all[1].ready();
    expect(Socket.all[1].sent.some((m) => m.type === 'request')).toBe(false);
  });
  it('removes canceled requests before handshake completion', async () => {
    const controller = new AbortController();
    const request = client.request(
      'getNode',
      { id: 'n', query: {} },
      { timeoutMs: 1000, signal: controller.signal },
    );
    const failed = expect(request).rejects.toBe('cancelled');
    controller.abort('cancelled');
    await failed;
    Socket.all[0].ready();
    expect(Socket.all[0].sent.some((m) => m.type === 'request')).toBe(false);
  });
});

it('shares change subscriptions, restores them on reconnect and removes the last consumer', async () => {
  const first = Socket.all[0];
  first.ready();
  expect(first.sent.at(-1)?.changes).toEqual([]);
  const changes = [{ kind: 'history', node_id: 'n' }];
  const removeA = client.subscribeChanges(changes);
  const count = first.sent.length;
  const removeB = client.subscribeChanges(changes);
  expect(first.sent).toHaveLength(count);
  removeA();
  expect(first.sent).toHaveLength(count);
  first.close(1006);
  await vi.advanceTimersByTimeAsync(2000);
  const second = Socket.all[1];
  second.ready();
  expect(second.sent.at(-1)?.changes).toEqual(changes);
  removeB();
  expect(second.sent.at(-1)?.changes).toEqual([]);
});
