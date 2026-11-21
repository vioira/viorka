import { useState } from 'react';
import { parseTaskPage, parseTaskSummary, type TaskPage, type TaskSummary } from '@/api/tasks';
import { type Cursor, cursorForPage, firstCursor } from '@/hooks/cursor-page';
import { useBrowserView } from '@/hooks/use-browser-view';

type View = Cursor & { state: string };
const initialView: View = { state: 'all', ...firstCursor };
export function useTasks() {
  const [revision, setRevision] = useState(0);
  const [requested, setRequested] = useState(initialView);
  const [view, setView] = useState(initialView);
  const [page, setPage] = useState<TaskPage>({ items: [], next_cursor: '' });
  const [summary, setSummary] = useState<TaskSummary | null>(null);
  const [loaded, setLoaded] = useState(false);
  const list = useBrowserView(
    'task_page',
    { state: requested.state, after: requested.after },
    revision,
    parseTaskPage,
    (data) => {
      setPage(data);
      setView(requested);
      setLoaded(true);
    },
  );
  const stats = useBrowserView('task_summary', {}, revision, parseTaskSummary, setSummary);
  const loading = list.loading;
  return {
    page,
    summary,
    view,
    loading,
    loaded,
    stale: list.failed || stats.failed,
    refresh: () => setRevision((n) => n + 1),
    filter: (state: string) => {
      if (!loading) setRequested({ state, ...firstCursor });
    },
    goToPage: (target: number) => {
      if (!loaded || loading) return;
      const cursor = cursorForPage(view, target, page.next_cursor);
      if (cursor !== view) setRequested({ state: view.state, ...cursor });
    },
  };
}
