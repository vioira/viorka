import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getNodeTask, listNodeTasks, type NodeTask } from '@/api/node-tasks';
import { Button } from '@/components/arc/button/button';
import DataTable from '@/components/data-table';
import { useRealtimeConnection, useServerEvent } from '@/hooks/realtime';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import TaskStatus from '@/views/tasks/components/TaskStatus';
import TaskTime from '@/views/tasks/components/TaskTime';

export default function NodeTasks({ id }: { id: string }) {
  const [items, setItems] = useState<NodeTask[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const rows = useRef<NodeTask[]>([]);
  const pages = useRef(1);
  const request = useRef<AbortController | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const resync = useRef(false);
  const pending = useRef(new Set<string>());
  const updates = useRef(new Map<string, NodeTask>());
  const connection = useRealtimeConnection();
  const [, report] = useToastFeedback('error');
  const load = useCallback(
    (mode: 'sync' | 'more' | 'changes' = 'sync'): Promise<void> => {
      if (inFlight.current) {
        if (mode === 'sync') resync.current = true;
        return inFlight.current;
      }
      const controller = new AbortController();
      request.current = controller;
      setLoading(true);
      const work = (async () => {
        try {
          let currentMode = mode;
          do {
            resync.current = false;
            if (currentMode === 'sync' || currentMode === 'more') {
              const next = currentMode === 'more' ? [...rows.current] : [];
              let batch: NodeTask[] = [];
              for (let page = 0; page < (currentMode === 'more' ? 1 : pages.current); page++) {
                batch = await listNodeTasks(id, next.at(-1)?.id, controller.signal);
                next.push(...batch);
                if (batch.length < 50) break;
              }
              if (controller.signal.aborted) return;
              rows.current = next;
              if (currentMode === 'more') pages.current++;
              setMore(batch.length === 50);
            }
            const ids = [...pending.current];
            pending.current.clear();
            for (const taskId of ids) {
              const task =
                updates.current.get(taskId) ?? (await getNodeTask(id, taskId, controller.signal));
              updates.current.delete(taskId);
              if (controller.signal.aborted) return;
              const exists = rows.current.some((item) => item.id === task.id);
              const last = rows.current.at(-1);
              if (
                exists ||
                !last ||
                task.created_at > last.created_at ||
                (task.created_at === last.created_at && task.id > last.id)
              ) {
                rows.current = [...rows.current.filter((item) => item.id !== task.id), task].sort(
                  (a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
                );
              }
            }
            if (rows.current.length > pages.current * 50) {
              rows.current = rows.current.slice(0, pages.current * 50);
              setMore(true);
            }
            setItems(rows.current);
            setLoaded(true);
            report('');
            currentMode = resync.current ? 'sync' : 'changes';
          } while (resync.current || pending.current.size > 0);
        } catch (error) {
          if (!controller.signal.aborted)
            report(error instanceof Error ? error.message : '无法读取任务，请刷新重试。');
        } finally {
          if (request.current === controller) {
            setLoading(false);
            inFlight.current = null;
          }
        }
      })();
      inFlight.current = work;
      return work;
    },
    [id, report],
  );
  const { initialized, enabled, generation } = connection;
  useEffect(() => {
    if (!initialized) return;
    if (!enabled || generation > 0) {
      void load();
      return;
    }
    const timer = setTimeout(() => void load(), 3000);
    return () => clearTimeout(timer);
  }, [initialized, enabled, generation, load]);
  useEffect(
    () => () => {
      request.current?.abort();
      inFlight.current = null;
    },
    [],
  );
  useServerEvent((event) => {
    if (
      event.type !== 'change' ||
      event.change.kind !== 'tasks' ||
      (event.change.node_id && event.change.node_id !== id)
    )
      return;
    if (!event.change.task_id || pending.current.size >= 256) {
      pending.current.clear();
      void load();
      return;
    }
    if (event.change.task) updates.current.set(event.change.task_id, event.change.task);
    pending.current.add(event.change.task_id);
    void load('changes');
  });
  return (
    <section aria-label="节点任务" aria-busy={loading} className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p role="status" className="text-(length:--text-xs) text-text-secondary tabular-nums">
          {loading
            ? '正在读取任务…'
            : loaded
              ? `已加载 ${items.length} 条，状态变更后自动更新`
              : '任务尚未读取'}
        </p>
        <Button variant="secondary" disabled={loading} onClick={() => void load()}>
          <RefreshCw size={16} aria-hidden="true" />
          刷新任务
        </Button>
      </div>
      <div className="v-card">
        <DataTable
          rows={items}
          rowKey="id"
          caption="该节点的持久化任务"
          tableClassName="sm:min-w-[720px]"
          emptyMessage={loaded ? '该节点暂无任务' : '任务尚未读取'}
          columns={[
            {
              key: 'id',
              label: '任务 ID',
              width: 190,
              sortable: false,
              render: (_, task) => (
                <span className="block max-w-28 truncate font-mono" title={task.id}>
                  {task.id}
                </span>
              ),
            },
            {
              key: 'operation_name',
              label: '类型',
              width: 176,
              render: (_, task) => (
                <span className="font-medium wrap-anywhere">{task.operation_name}</span>
              ),
            },
            {
              key: 'state',
              label: '状态',
              width: 112,
              render: (_, task) => (
                <TaskStatus
                  state={task.state}
                  errorCode={task.error_code}
                  diagnostic={task.diagnostic}
                />
              ),
            },
            {
              key: 'attempt',
              label: '执行次数',
              width: 88,
              render: (_, task) => (
                <span className="whitespace-nowrap text-text-secondary tabular-nums">
                  {task.attempt}
                </span>
              ),
            },
            {
              key: 'deadline_at',
              label: '截止时间',
              width: 192,
              render: (_, task) => (
                <span className="whitespace-nowrap text-text-secondary">
                  <TaskTime value={task.deadline_at} />
                </span>
              ),
            },
          ]}
        />
      </div>
      {more && (
        <Button variant="secondary" disabled={loading} onClick={() => void load('more')}>
          加载更多任务
        </Button>
      )}
    </section>
  );
}
