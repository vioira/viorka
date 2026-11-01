import type { Notification } from './settings';

export interface NotificationDelta {
  items: Notification[];
  removed_ids: string[];
}

export function parseNotificationEvent(data: string, snapshot: boolean): NotificationDelta {
  const value = JSON.parse(data);
  if (
    !value ||
    !Array.isArray(value.items) ||
    value.items.length > 100 ||
    !value.items.every(
      (item: unknown) =>
        typeof item === 'object' &&
        item !== null &&
        'id' in item &&
        typeof item.id === 'string' &&
        'node_id' in item &&
        typeof item.node_id === 'string' &&
        'created_at' in item &&
        typeof item.created_at === 'string' &&
        'message' in item &&
        typeof item.message === 'string' &&
        'read' in item &&
        typeof item.read === 'boolean',
    ) ||
    (!snapshot &&
      (!Array.isArray(value.removed_ids) ||
        !value.removed_ids.every((id: unknown) => typeof id === 'string')))
  ) {
    throw new Error('Invalid notification event');
  }
  return { items: value.items, removed_ids: snapshot ? [] : value.removed_ids };
}

export function applyNotificationDelta(
  current: Notification[],
  delta: NotificationDelta,
): Notification[] {
  const items = new Map(current.map((item) => [item.id, item]));
  for (const id of delta.removed_ids) items.delete(id);
  for (const item of delta.items) items.set(item.id, item);
  return [...items.values()]
    .sort((a, b) => {
      if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
      return a.id === b.id ? 0 : a.id < b.id ? 1 : -1;
    })
    .slice(0, 100);
}
