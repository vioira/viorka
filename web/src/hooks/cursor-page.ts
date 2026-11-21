export type Cursor = { after: string; history: string[] };

export const firstCursor: Cursor = { after: '', history: [] };

export function cursorForPage(cursor: Cursor, page: number, next: string): Cursor {
  const current = cursor.history.length + 1;
  if (page >= 1 && page < current) {
    return { after: cursor.history[page - 1], history: cursor.history.slice(0, page - 1) };
  }
  if (page === current + 1 && next) {
    return { after: next, history: [...cursor.history, cursor.after] };
  }
  return cursor;
}

export function pageWithLookahead<T extends { id: string }>(items: T[], pageSize: number) {
  const visible = items.slice(0, pageSize);
  return { items: visible, nextCursor: items.length > pageSize ? (visible.at(-1)?.id ?? '') : '' };
}
