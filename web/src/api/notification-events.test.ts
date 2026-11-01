import { describe, expect, it } from 'vitest';
import { applyNotificationDelta, parseNotificationEvent } from './notification-events';
import type { Notification } from './settings';

const item = (id: string): Notification => ({
  id,
  read: false,
  node_id: 'node',
  created_at: '2026-10-31T00:00:00Z',
  message: '离线',
});

describe('notification events', () => {
  it('merges, deduplicates, removes and sorts notifications', () => {
    const current = [item('b'), item('a')];
    const delta = { items: [item('c'), item('b')], removed_ids: ['a'] };
    const result = applyNotificationDelta(current, delta);
    expect(result.map((value) => value.id)).toEqual(['c', 'b']);
    expect(applyNotificationDelta(result, delta)).toEqual(result);
    expect(current).toHaveLength(2);
  });
  it('replaces stale history on reconnect and bounds the retained list', () => {
    const snapshot = parseNotificationEvent(JSON.stringify({ items: [item('new')] }), true);
    expect(applyNotificationDelta([], snapshot)).toEqual([item('new')]);
    const items = Array.from({ length: 110 }, (_, i) => item(String(i)));
    expect(applyNotificationDelta(items, { items: [], removed_ids: [] })).toHaveLength(100);
  });
  it('applies read state updates without duplicating alerts', () => {
    const current = [item('a')];
    expect(
      applyNotificationDelta(current, { items: [{ ...item('a'), read: true }], removed_ids: [] }),
    ).toEqual([{ ...item('a'), read: true }]);
    expect(current[0].read).toBe(false);
    expect(() =>
      parseNotificationEvent(JSON.stringify({ items: [{ ...item('a'), read: 'true' }] }), true),
    ).toThrow();
  });
  it('rejects malformed payloads before updating state', () => {
    for (const data of ['null', '{}', '{"items":[{}]}', '{"items":[],"removed_ids":[1]}']) {
      expect(() => parseNotificationEvent(data, false)).toThrow();
    }
    expect(parseNotificationEvent('{"items":[]}', true).items).toEqual([]);
  });
});
