import { useEffect, useState } from 'react';
import { listNodeTasks, type NodeTask, taskStates } from '@/api/node-tasks';
import { nodeTime } from '@/api/nodes';
import { Button } from '@/components/arc/button/button';
import DataTable from '@/components/data-table';
import { useToastFeedback } from '@/hooks/use-toast-feedback';

export default function NodeTasks({ id }: { id: string }) {
  const [items, setItems] = useState<NodeTask[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pages, setPages] = useState(1);
  const [more, setMore] = useState(false);
  const [retry, setRetry] = useState(0);
  const [, report] = useToastFeedback('error');
  useEffect(() => {
    void retry;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
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
          timer = setTimeout(load, 5000);
        }
      }
    }
    setLoading(true);
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [id, pages, retry, report]);
  return (
    <section aria-label="节点任务" aria-busy={loading} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-medium">节点任务</h2>
        <Button variant="secondary" disabled={loading} onClick={() => setRetry((n) => n + 1)}>
          刷新任务
        </Button>
      </div>
      <p className="text-text-secondary">
        提交、派发与实际完成是不同状态。列表每 5 秒更新，最新创建的任务优先。
      </p>
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
            render: (_, task) => <span className="block max-w-64 wrap-anywhere">{task.id}</span>,
          },
          {
            key: 'operation',
            label: '类型',
            render: (_, task) => (task.operation === 'node.inspect' ? '只读检查' : task.operation),
          },
          { key: 'state', label: '状态', render: (_, task) => taskStates[task.state] ?? '未知' },
          { key: 'attempt', label: '执行次数' },
          {
            key: 'deadline_at',
            label: '截止时间',
            render: (_, task) => nodeTime(task.deadline_at),
          },
        ]}
      />
      {more && (
        <Button variant="secondary" disabled={loading} onClick={() => setPages((n) => n + 1)}>
          加载更多任务
        </Button>
      )}
    </section>
  );
}
