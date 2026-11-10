import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NodeRecord } from '@/api/nodes';
import type { ServerEvent } from '@/hooks/realtime';

// Stateful hook harness: re-render explicitly after effects/events settle.
const h = vi.hoisted(() => ({
  slots: [] as {
    value?: unknown;
    current?: unknown;
    deps?: unknown[];
    fn?: unknown;
    cleanup?: (() => void) | undefined;
  }[],
  cursor: 0,
  effects: [] as (() => void)[],
  connection: { enabled: true, initialized: false, generation: 0, connected: false },
  listener: (_event: ServerEvent) => {},
  list: vi.fn(),
  report: vi.fn(),
  live: { items: {}, refresh: vi.fn() },
}));
vi.mock('react', () => ({
  useState(initial: unknown) {
    const i = h.cursor++;
    if (!(i in h.slots)) h.slots[i] = { value: initial };
    return [
      h.slots[i].value,
      (v: unknown) => {
        h.slots[i].value = typeof v === 'function' ? v(h.slots[i].value) : v;
      },
    ];
  },
  useRef(initial: unknown) {
    const i = h.cursor++;
    h.slots[i] ??= { current: initial };
    return h.slots[i];
  },
  useCallback(fn: unknown, deps: unknown[]) {
    const i = h.cursor++;
    const old = h.slots[i];
    if (!old || deps.some((d, j) => d !== old.deps?.[j])) h.slots[i] = { fn, deps };
    return h.slots[i].fn;
  },
  useEffect(fn: () => (() => void) | undefined, deps: unknown[]) {
    const i = h.cursor++;
    const old = h.slots[i];
    if (!old || deps.some((d, j) => d !== old.deps?.[j])) {
      h.effects.push(() => {
        old?.cleanup?.();
        h.slots[i] = { deps, cleanup: fn() };
      });
    }
  },
}));
vi.mock('@/api/nodes', () => ({ listAllNodes: h.list }));
vi.mock('@/hooks/realtime', () => ({
  useRealtimeConnection: () => h.connection,
  useServerEvent: (listener: typeof h.listener) => {
    h.listener = listener;
  },
}));
vi.mock('@/hooks/use-live-metrics', () => ({ useListMetrics: () => h.live }));
vi.mock('@/hooks/use-toast-feedback', () => ({ useToastFeedback: () => ['', h.report] }));

import { useNodes } from './use-nodes';

function render() {
  h.cursor = 0;
  // biome-ignore lint/correctness/useHookAtTopLevel: Explicit hook harness.
  const value = useNodes();
  for (const effect of h.effects.splice(0)) effect();
  return value;
}
const node: NodeRecord = {
  id: 'n',
  name: 'Node',
  kind: 'vps',
  state: 'online',
  last_seen_at: '',
  os: '',
  arch: '',
  agent_version: '',
  engines: [],
};
async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
beforeEach(() => {
  vi.useFakeTimers();
  h.slots = [];
  h.effects = [];
  h.connection = { enabled: true, initialized: false, generation: 0, connected: false };
  h.list.mockReset().mockResolvedValue([node]);
});
afterEach(() => {
  for (const slot of h.slots) slot?.cleanup?.();
  vi.useRealTimers();
});
it('loads once after settings and first ready, then resynchronizes on reconnect', async () => {
  render();
  expect(h.list).not.toHaveBeenCalled();
  h.connection.initialized = true;
  render();
  h.connection.generation = 1;
  h.connection.connected = true;
  render();
  await settle();
  await vi.advanceTimersByTimeAsync(3000);
  expect(h.list).toHaveBeenCalledTimes(1);
  expect(render().nodes).toEqual([node]);
  await render().created();
  expect(h.list).toHaveBeenCalledTimes(1);
  h.connection.generation++;
  render();
  await settle();
  expect(h.list).toHaveBeenCalledTimes(2);
});
it('coalesces manual refreshes and preserves engine updates arriving during a read', async () => {
  h.connection = { enabled: false, initialized: true, generation: 0, connected: false };
  let resolve!: (items: NodeRecord[]) => void;
  h.list.mockImplementationOnce(
    () =>
      new Promise<NodeRecord[]>((done) => {
        resolve = done;
      }),
  );
  const data = render();
  const first = data.refresh();
  const second = data.refresh();
  expect(first).toBe(second);
  const updated = { ...node, engines: [{ name: 'realm', version: '2.9.6' }] };
  h.listener({ type: 'change', change: { kind: 'node', node_id: 'n', node: updated } });
  resolve([node]);
  await first;
  expect(render().nodes[0].engines).toEqual(updated.engines);
  expect(h.list).toHaveBeenCalledTimes(1);
  h.listener({ type: 'change', change: { kind: 'node', node_id: 'n', node } });
  expect(render().nodes[0].engines).toEqual([]);
  expect(h.list).toHaveBeenCalledTimes(1);
});
it('coalesces collection invalidations into one trailing read without cancelling pagination', async () => {
  h.connection = { enabled: false, initialized: true, generation: 0, connected: false };
  let resolve!: (items: NodeRecord[]) => void;
  h.list.mockImplementationOnce(
    () =>
      new Promise<NodeRecord[]>((done) => {
        resolve = done;
      }),
  );
  render();
  for (let i = 0; i < 3; i++) h.listener({ type: 'change', change: { kind: 'nodes' } });
  h.list.mockResolvedValue([node, { ...node, id: 'new' }]);
  resolve([node]);
  await settle();
  expect(h.list).toHaveBeenCalledTimes(2);
  expect(render().nodes.map((n) => n.id)).toEqual(['n', 'new']);
});
it('loads via REST when the initial SSE cannot connect', async () => {
  h.connection.initialized = true;
  render();
  await vi.advanceTimersByTimeAsync(3000);
  expect(h.list).toHaveBeenCalledTimes(1);
  expect(render().loaded).toBe(true);
});
