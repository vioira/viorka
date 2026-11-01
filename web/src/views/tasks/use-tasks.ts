import { useEffect, useId, useState } from 'react';
import { getTaskSummary, listTasks, type TaskPage, type TaskSummary } from '@/api/tasks';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { useChangeVersion } from '@/hooks/realtime';

type View = { state: string; after: string; history: string[] };
const initialView: View = { state: 'all', after: '', history: [] };
export function useTasks() {
  const eventVersion = useChangeVersion('tasks');
  const [requested, setRequested] = useState(initialView);
  const [view, setView] = useState(initialView);
  const [page, setPage] = useState<TaskPage>({ items: [], next_cursor: '' });
  const [summary, setSummary] = useState<TaskSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [stale, setStale] = useState(false);
  const { toast, dismiss } = useToastStack();
  const id = useId();
  useEffect(() => {
    void eventVersion; // A committed change invalidates this read.
    const controller = new AbortController();
    async function load() {
      const results = await Promise.allSettled([
        listTasks(requested.state, requested.after, controller.signal),
        getTaskSummary(controller.signal),
      ]);
      if (controller.signal.aborted) return;
      const [tasks, stats] = results;
      if (tasks.status === 'fulfilled') {
        setPage(tasks.value);
        setView(requested);
        setLoaded(true);
        dismiss(`${id}-list`);
      } else {
        toast({
          id: `${id}-list`,
          type: 'error',
          title: '任务列表读取失败',
          description: tasks.reason instanceof Error ? tasks.reason.message : '请刷新任务重试。',
        });
      }
      if (stats.status === 'fulfilled') {
        setSummary(stats.value);
        dismiss(`${id}-summary`);
      } else {
        toast({
          id: `${id}-summary`,
          type: 'error',
          title: '任务统计读取失败',
          description: stats.reason instanceof Error ? stats.reason.message : '请刷新任务重试。',
        });
      }
      setStale(results.some((result) => result.status === 'rejected'));
      setLoading(false);
    }
    setLoading(true);
    void load();
    return () => {
      controller.abort();
    };
  }, [requested, id, toast, dismiss, eventVersion]);
  return {
    page,
    summary,
    view,
    loading,
    loaded,
    stale,
    refresh: () => setRequested({ ...view }),
    filter: (state: string) => {
      if (!loading) setRequested({ state, after: '', history: [] });
    },
    previous: () =>
      setRequested({
        state: view.state,
        after: view.history.at(-1) ?? '',
        history: view.history.slice(0, -1),
      }),
    next: () =>
      setRequested({
        state: view.state,
        after: page.next_cursor,
        history: [...view.history, view.after],
      }),
  };
}
