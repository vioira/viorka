import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Exercise the hook's actual effect resource lifecycle without a DOM package.
// React scheduling/rendering is separate browser coverage, not simulated here.
const h = vi.hoisted(() => ({
  effect: undefined as undefined | (() => undefined | (() => void)),
  states: [] as unknown[],
  frames: [] as unknown[],
  enabled: true,
  toast: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock('react', () => ({
  useId: () => 'metrics-test',
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
vi.mock('./realtime', () => ({ useRealtimeEnabled: () => h.enabled }));
vi.mock('@/components/arc/toast-stack/toast-stack', () => ({
  useToastStack: () => ({ toast: h.toast, dismiss: h.dismiss }),
}));

import { useLiveMetrics } from './use-live-metrics';

class Source extends EventTarget {
  static CLOSED = 2;
  static all: Source[] = [];
  readyState = 1;
  onerror: (() => void) | null = null;
  close = vi.fn(() => {
    this.readyState = Source.CLOSED;
  });
  constructor(readonly url: string) {
    super();
    Source.all.push(this);
  }
  metrics(data = '{"reset":true,"items":{},"removed_ids":[]}') {
    this.dispatchEvent(new MessageEvent('metrics', { data }));
  }
}
let doc: EventTarget & { hidden: boolean };
let cleanup: (() => void) | undefined;
function mount(scope = 'node=n') {
  // biome-ignore lint/correctness/useHookAtTopLevel: This effect harness intentionally substitutes React hooks.
  useLiveMetrics(scope);
  cleanup = h.effect?.() || undefined;
}
beforeEach(() => {
  h.states = [];
  h.frames = [];
  h.enabled = true;
  h.toast.mockClear();
  h.dismiss.mockClear();
  Source.all = [];
  doc = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('EventSource', Source);
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.unstubAllGlobals();
});

describe('metric stream effect lifecycle', () => {
  it('releases hidden demand and ignores old terminal events after visibility resumes', () => {
    mount();
    const old = Source.all[0];
    expect(old.url).toBe('/api/v1/metrics/events?node=n');
    old.metrics();
    expect(h.states.at(-1)).toBe('live');
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(old.close).toHaveBeenCalledOnce();
    expect(h.states.at(-1)).toBe('paused');
    doc.hidden = false;
    doc.dispatchEvent(new Event('visibilitychange'));
    const current = Source.all[1];
    current.metrics();
    const frames = h.frames.length;
    old.dispatchEvent(new Event('closed'));
    old.onerror?.();
    old.metrics();
    expect(h.states.at(-1)).toBe('live');
    expect(h.toast).not.toHaveBeenCalled();
    expect(h.frames).toHaveLength(frames);
    expect(current.close).not.toHaveBeenCalled();
  });
  it.each(['closed', 'malformed', 'error_closed'])(
    'invalidates a terminal %s stream until explicit reconnect',
    (reason) => {
      mount();
      const source = Source.all[0];
      if (reason === 'closed') source.dispatchEvent(new Event('closed'));
      else if (reason === 'error_closed') {
        source.readyState = Source.CLOSED;
        source.onerror?.();
      } else source.metrics('not-json');
      expect(source.close).toHaveBeenCalledOnce();
      expect(h.states.at(-1)).toBe('closed');
      expect(h.toast).toHaveBeenCalledOnce();
      source.metrics();
      source.onerror?.();
      source.dispatchEvent(new Event('closed'));
      expect(h.frames).toHaveLength(0);
      expect(h.toast).toHaveBeenCalledOnce();
      expect(h.states.at(-1)).toBe('closed');
    },
  );
  it('removes visibility handling and fences all events after cleanup or scope replacement', () => {
    mount();
    const old = Source.all[0];
    cleanup?.();
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(Source.all).toHaveLength(1);
    mount('node=next');
    Source.all[1].metrics();
    old.dispatchEvent(new Event('closed'));
    old.metrics();
    old.onerror?.();
    expect(h.states.at(-1)).toBe('live');
    expect(h.toast).not.toHaveBeenCalled();
    expect(h.frames).toHaveLength(1);
  });
  it('never opens a stream for disabled, empty, or initially hidden scopes', () => {
    h.enabled = false;
    mount();
    expect(h.states.at(-1)).toBe('disabled');
    h.enabled = true;
    mount('');
    expect(h.states.at(-1)).toBe('disabled');
    doc.hidden = true;
    mount();
    expect(h.states.at(-1)).toBe('paused');
    expect(Source.all).toHaveLength(0);
  });
});
