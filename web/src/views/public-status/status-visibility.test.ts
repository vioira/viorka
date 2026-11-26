import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { observeStatusVisibility } from './status-visibility';

const doc = Object.assign(new EventTarget(), { hidden: false });
const win = new EventTarget();
let cleanup: (() => void) | undefined;

function hide(hidden: boolean) {
  doc.hidden = hidden;
  doc.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  doc.hidden = false;
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', Object.assign(win, { setTimeout, clearTimeout }));
});
afterEach(() => {
  cleanup?.();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('keeps the stream for 29 seconds, restarts the grace on the next hide and resumes once', () => {
  const close = vi.fn();
  const connect = vi.fn(() => close);
  cleanup = observeStatusVisibility(connect);
  hide(true);
  vi.advanceTimersByTime(29_000);
  hide(false);
  expect(close).not.toHaveBeenCalled();
  expect(connect).toHaveBeenCalledTimes(1);
  hide(true);
  vi.advanceTimersByTime(29_999);
  hide(true);
  expect(close).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(close).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(60_000);
  expect(connect).toHaveBeenCalledTimes(1);
  hide(false);
  win.dispatchEvent(new Event('pageshow'));
  expect(connect).toHaveBeenCalledTimes(2);
});

it('waits for first visibility, releases on navigation, and ignores events after cleanup', () => {
  doc.hidden = true;
  const close = vi.fn();
  const connect = vi.fn(() => close);
  cleanup = observeStatusVisibility(connect);
  expect(connect).not.toHaveBeenCalled();
  hide(false);
  hide(true);
  win.dispatchEvent(new Event('pagehide'));
  hide(false);
  expect(close).toHaveBeenCalledTimes(1);
  expect(connect).toHaveBeenCalledTimes(1);
  win.dispatchEvent(new Event('pageshow'));
  expect(connect).toHaveBeenCalledTimes(2);
  hide(true);
  cleanup();
  hide(false);
  vi.advanceTimersByTime(30_000);
  expect(close).toHaveBeenCalledTimes(2);
  expect(connect).toHaveBeenCalledTimes(2);
});

it('renews an overdue stream when a frozen tab resumes before its timer fires', () => {
  const close = vi.fn();
  const connect = vi.fn(() => close);
  cleanup = observeStatusVisibility(connect);
  hide(true);
  vi.setSystemTime(Date.now() + 31_000);
  hide(false);
  expect(close).toHaveBeenCalledTimes(1);
  expect(connect).toHaveBeenCalledTimes(2);
});
