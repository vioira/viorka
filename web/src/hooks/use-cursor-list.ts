import { useCallback, useEffect, useRef, useState } from 'react';
import { type Cursor, cursorForPage, firstCursor, pageWithLookahead } from './cursor-page';

// These collection endpoints accept at most 100 rows per request. Reserve one for lookahead.
export const cursorListPageSizes = [10, 20, 50];

type Request = { cursor: Cursor; pageSize: number };
type Result<T> = Request & { items: T[]; nextCursor: string };

export function useCursorList<T extends { id: string }>({
  enabled,
  fetchItems,
  defaultPageSize,
  errorMessage,
}: {
  enabled: boolean;
  fetchItems: (after: string, signal: AbortSignal, limit: number) => Promise<T[]>;
  defaultPageSize: number;
  errorMessage: string;
}) {
  const [result, setResult] = useState<Result<T>>();
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  const live = useRef(false);
  const committed = useRef<Request | null>(null);
  const lastRequest = useRef<Request | null>(null);
  const cursor = result?.cursor ?? firstCursor;
  const pageSize = result?.pageSize ?? defaultPageSize;
  const nextCursor = result?.nextCursor ?? '';

  const load = useCallback(
    async (request: Request): Promise<boolean> => {
      if (!live.current) return false;
      active.current?.abort();
      const controller = new AbortController();
      active.current = controller;
      lastRequest.current = request;
      setLoading(true);
      setError('');
      try {
        const items = await fetchItems(
          request.cursor.after,
          controller.signal,
          request.pageSize + 1,
        );
        if (controller.signal.aborted) return false;
        committed.current = request;
        setResult({ ...request, ...pageWithLookahead(items, request.pageSize) });
        return true;
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : errorMessage);
        return false;
      } finally {
        if (!controller.signal.aborted) {
          active.current = null;
          setLoading(false);
        }
      }
    },
    [fetchItems, errorMessage],
  );

  const refresh = useCallback(
    (fromFirst = false) =>
      load({
        cursor: fromFirst ? firstCursor : (committed.current?.cursor ?? firstCursor),
        pageSize: committed.current?.pageSize ?? defaultPageSize,
      }),
    [defaultPageSize, load],
  );
  useEffect(() => {
    if (!enabled) return;
    live.current = true;
    void refresh();
    return () => {
      live.current = false;
      active.current?.abort();
      active.current = null;
    };
  }, [enabled, refresh]);

  return {
    items: result?.items ?? [],
    loaded: result !== undefined,
    loading: loading || (enabled && result === undefined && !error),
    error,
    page: cursor.history.length + 1,
    hasNext: !!nextCursor,
    pageSize,
    goToPage: (page: number) => {
      if (loading || active.current) return;
      const target = cursorForPage(cursor, page, nextCursor);
      if (target !== cursor) void load({ cursor: target, pageSize });
    },
    changePageSize: (size: number) => {
      if (!loading && !active.current && size !== pageSize && cursorListPageSizes.includes(size))
        void load({ cursor: firstCursor, pageSize: size });
    },
    refresh,
    retry: () => {
      if (lastRequest.current) void load(lastRequest.current);
    },
    reset: () => {
      active.current?.abort();
      active.current = null;
      committed.current = null;
      lastRequest.current = null;
      setResult(undefined);
      setError('');
      setLoading(false);
    },
    updateItems: (update: (items: T[]) => T[]) =>
      setResult((value) => value && { ...value, items: update(value.items) }),
  };
}
