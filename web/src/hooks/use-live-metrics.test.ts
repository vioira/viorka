import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  effect: undefined as undefined | (() => undefined | (() => void)),
  states: [] as unknown[],
  frames: [] as unknown[],
  enabled: true,
  listener: undefined as undefined | ((event: { event: string; data?: unknown }) => void),
  setMetrics: vi.fn(),
  unsubscribe: vi.fn(),
  toast: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock('react', () => ({
  useId: () => 'metrics-test',
  useRef: (current: unknown) => ({ current }),
  useCallback: (fn: unknown) => fn,
  useEffect: (fn: () => undefined | (() => void)) => {
    h.effect = fn;
  },
  useState: (initial: unknown) => [
    initial,
    (value: unknown) => {
      if (typeof initial === 'string') h.states.push(value);
      if (typeof initial === 'object') h.frames.push(value);
    },
  ],
}));
vi.mock('./realtime', () => ({
  useRealtimeEnabled: () => h.enabled,
  useBrowserSocket: () => ({
    setMetrics: h.setMetrics,
    subscribe: (listener: typeof h.listener) => {
      h.listener = listener;
      return h.unsubscribe;
    },
  }),
}));
vi.mock('@/components/arc/toast-stack/toast-stack', () => ({
  useToastStack: () => ({ toast: h.toast, dismiss: h.dismiss }),
}));

import { useLiveMetrics } from './use-live-metrics';

let doc: EventTarget & { hidden: boolean };
let cleanup: (() => void) | undefined;
function mount(scope = 'node=n') {
  // biome-ignore lint/correctness/useHookAtTopLevel: Execute the resource effect with substituted hooks.
  useLiveMetrics(scope);
  cleanup = h.effect?.() || undefined;
}
beforeEach(() => {
  vi.clearAllMocks();
  h.states = [];
  h.frames = [];
  h.enabled = true;
  doc = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal('document', doc);
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.unstubAllGlobals();
});
describe('metric subscription lifecycle', () => {
  it('pauses only demand when hidden and restores the same transport subscription', () => {
    mount();
    expect(h.setMetrics).toHaveBeenLastCalledWith('node=n');
    h.listener?.({ event: 'metrics', data: { reset: true, items: {}, removed_ids: [] } });
    expect(h.states.at(-1)).toBe('live');
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(h.setMetrics).toHaveBeenLastCalledWith('');
    expect(h.states.at(-1)).toBe('paused');
    doc.hidden = false;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(h.setMetrics).toHaveBeenLastCalledWith('node=n');
  });
  it('fences callbacks and removes demand after cleanup', () => {
    mount();
    const old = h.listener;
    cleanup?.();
    old?.({ event: 'metrics', data: { reset: true, items: {}, removed_ids: [] } });
    expect(h.frames).toHaveLength(0);
    expect(h.unsubscribe).toHaveBeenCalledOnce();
    const calls = h.setMetrics.mock.calls.length;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(h.setMetrics).toHaveBeenCalledTimes(calls);
    cleanup = undefined;
  });
  it('reports malformed frames and closes only the metric subscription', () => {
    mount();
    h.listener?.({ event: 'metrics', data: 'invalid' });
    expect(h.states.at(-1)).toBe('closed');
    expect(h.setMetrics).toHaveBeenLastCalledWith('');
    expect(h.toast).toHaveBeenCalledOnce();
  });
  it('does not subscribe empty or disabled scopes', () => {
    h.enabled = false;
    mount();
    h.enabled = true;
    mount('');
    expect(h.states.at(-1)).toBe('disabled');
    expect(h.setMetrics).not.toHaveBeenCalled();
  });
});
