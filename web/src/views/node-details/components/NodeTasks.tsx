import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { listNodeTasks, type NodeTask } from '@/api/node-tasks';
import { Button } from '@/components/arc/button/button';
import DataTable from '@/components/data-table';
import { useChangeVersion } from '@/hooks/realtime';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import TaskStatus from '@/views/tasks/components/TaskStatus';
import TaskTime from '@/views/tasks/components/TaskTime';

export default function NodeTasks({ id }: { id: string }) {
  const eventVersion = useChangeVersion('tasks', id);
  const [items, setItems] = useState<NodeTask[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pages, setPages] = useState(1);
  const [more, setMore] = useState(false);
  const [retry, setRetry] = useState(0);
  const [, report] = useToastFeedback('error');
  useEffect(() => {
    void eventVersion; // A committed change invalidates this read.
    void retry;
    const controller = new AbortController();
    async function load() {
      try {
        const next: NodeTask[] = [];
        let batch: NodeTask[] = [];
        for (let page = 0; page < pages; page++) {
          batch = await listNodeTasks(id, next.at(-1)?.id, controller.signal);
          next.push(...batch);
          if (batch.length < 50) break;
        }
        if (!controller.signal.aborted) {
          setItems(next);
          setMore(batch.length === 50);
          setLoaded(true);
          report('');
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          report(cause instanceof Error ? cause.message : '无法读取任务，请刷新重试。');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }
    setLoading(true);
    void load();
    return () => {
      controller.abort();
    };
  }, [id, pages, retry, report, eventVersion]);
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
        <Button variant="secondary" disabled={loading} onClick={() => setRetry((n) => n + 1)}>
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
        <Button variant="secondary" disabled={loading} onClick={() => setPages((n) => n + 1)}>
          加载更多任务
        </Button>
      )}
    </section>
  );
}
