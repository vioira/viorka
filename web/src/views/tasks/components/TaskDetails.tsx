import { Check, Circle, Copy, RefreshCw } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { Session } from '@/api/auth';
import { inspectNode } from '@/api/node-tasks';
import { getTask, type TaskRecord } from '@/api/tasks';
import { Button } from '@/components/arc/button/button';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { useChangeVersion } from '@/hooks/realtime';
import { taskDuration, taskFinished, taskNote } from '../task-display';
import TaskStatus from './TaskStatus';
import TaskTime from './TaskTime';

export default function TaskDetails({
  id,
  session,
  onCreated,
}: {
  id: string;
  session: Session;
  onCreated: (id: string) => void;
}) {
  const eventVersion = useChangeVersion('tasks');
  const [task, setTask] = useState<TaskRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [fresh, setFresh] = useState(false);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const key = useRef<string | null>(null);
  const toastId = useId();
  const { toast, dismiss } = useToastStack();
  useEffect(() => {
    void eventVersion; // A committed change invalidates this read.
    const controller = new AbortController();
    void retry;
    async function load() {
      try {
        const result = await getTask(id, controller.signal);
        if (controller.signal.aborted) return;
        setTask(result);
        setFresh(true);
        dismiss(toastId);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setFresh(false);
        toast({
          id: toastId,
          type: 'error',
          title: '任务详情读取失败',
          description: cause instanceof Error ? cause.message : '请刷新详情重试。',
        });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    setLoading(true);
    void load();
    return () => {
      controller.abort();
    };
  }, [id, retry, toastId, toast, dismiss, eventVersion]);
  async function copyKey() {
    if (!task) return;
    try {
      await navigator.clipboard.writeText(task.idempotency_key);
      toast({ type: 'success', title: '已复制任务幂等键' });
    } catch {
      toast({ id: `${toastId}-copy`, type: 'error', title: '复制失败，请从任务载荷中手动复制。' });
    }
  }
  async function recheck() {
    if (!task || !fresh || locked.current || session.user.role === 'viewer') return;
    locked.current = true;
    setBusy(true);
    key.current ??= crypto.randomUUID();
    try {
      const created = await inspectNode(task.node_id, session, key.current);
      key.current = null;
      toast({
        type: 'success',
        title: '新的检查任务已提交',
        description: '等待 Agent 执行，提交成功不代表检查完成。',
      });
      onCreated(created.id);
    } catch (cause) {
      toast({
        id: `${toastId}-create`,
        type: 'error',
        title: '检查任务提交未确认',
        description: `${cause instanceof Error ? cause.message : '请重试。'} 再次提交将复用同一请求标识。`,
      });
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  const steps = [
    {
      title: '任务已持久化',
      done: !!task,
      description: task ? '已写入任务队列' : '尚未读取任务记录',
    },
    {
      title: '派发到节点',
      done: !!task && task.attempt > 0,
      description: task
        ? task.attempt > 0
          ? `已进行 ${task.attempt} 次投递，不代表执行成功`
          : '尚无派发记录'
        : '尚未读取派发状态',
    },
    {
      title: task && taskFinished(task) ? '已记录最终状态' : '等待最终结果',
      done: !!task && taskFinished(task),
      description: task ? taskNote(task) : '尚未读取执行结果',
    },
  ];
  return (
    <div aria-busy={loading} className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {task ? (
          <TaskStatus state={task.state} />
        ) : (
          <p className="text-text-secondary">任务尚未读取</p>
        )}
        <Button
          variant="secondary"
          disabled={loading || busy}
          onClick={() => setRetry((n) => n + 1)}
        >
          <RefreshCw size={16} aria-hidden="true" />
          刷新详情
        </Button>
      </div>
      <p role="status" className="text-(length:--text-xs) text-text-secondary">
        {loading ? '正在读取任务详情…' : !fresh ? '详情尚未同步' : '详情已同步'}
      </p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3">
        <dt className="text-text-secondary">任务 ID</dt>
        <dd className="wrap-anywhere font-mono">{id}</dd>
        <dt className="text-text-secondary">任务类型</dt>
        <dd>{task?.operation_name ?? '未知'}</dd>
        <dt className="text-text-secondary">目标节点</dt>
        <dd className="wrap-anywhere">
          {task?.node_name ?? '未知'}
          {task && (
            <span className="mt-1 block font-mono text-(length:--text-xs) text-text-secondary">
              {task.node_id}
            </span>
          )}
        </dd>
        <dt className="text-text-secondary">尝试次数</dt>
        <dd className="tabular-nums">{task ? `${task.attempt} / ${task.max_attempts}` : '未知'}</dd>
        <dt className="text-text-secondary">创建时间</dt>
        <dd>{task ? <TaskTime value={task.created_at} /> : '未知'}</dd>
        <dt className="text-text-secondary">最后更新</dt>
        <dd>{task ? <TaskTime value={task.updated_at} /> : '未知'}</dd>
        <dt className="text-text-secondary">截止时间</dt>
        <dd>{task ? <TaskTime value={task.deadline_at} /> : '未知'}</dd>
        <dt className="text-text-secondary">总耗时</dt>
        <dd className="tabular-nums">
          {task ? taskDuration(task) : '未知'}
          <span className="ml-2 text-text-secondary">含排队</span>
        </dd>
      </dl>
      <ol aria-label="任务执行阶段" className="space-y-6 border-y-[1px] border-border py-6">
        {steps.map((step) => (
          <li key={step.title} className="flex gap-3">
            {step.done ? (
              <Check size={20} aria-hidden="true" className="shrink-0 text-accent" />
            ) : (
              <Circle size={20} aria-hidden="true" className="shrink-0 text-text-secondary" />
            )}
            <div>
              <p className="font-medium">{step.title}</p>
              <p className="mt-1 text-text-secondary">{step.description}</p>
            </div>
          </li>
        ))}
      </ol>
      <section aria-labelledby={`${toastId}-payload`} className="space-y-3">
        <h3 id={`${toastId}-payload`} className="font-medium">
          任务载荷
        </h3>
        <pre className="max-h-80 overflow-auto rounded-(--radius-control) bg-surface-muted p-4 font-mono text-(length:--text-xs)">
          {task
            ? JSON.stringify(
                {
                  operation: task.operation,
                  node_id: task.node_id,
                  idempotency_key: task.idempotency_key,
                  attempt: task.attempt,
                  deadline_at: task.deadline_at,
                },
                null,
                2,
              )
            : '尚未读取'}
        </pre>
      </section>
      <section aria-labelledby={`${toastId}-result`} className="space-y-3">
        <h3 id={`${toastId}-result`} className="font-medium">
          执行结果
        </h3>
        <pre className="max-h-80 overflow-auto rounded-(--radius-control) bg-surface-muted p-4 font-mono text-(length:--text-xs)">
          {task?.result != null
            ? JSON.stringify(task.result, null, 2)
            : task?.error_code
              ? JSON.stringify({ error_code: task.error_code }, null, 2)
              : '尚无 Agent 结果回报'}
        </pre>
      </section>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" disabled={!task} onClick={copyKey}>
          <Copy size={16} aria-hidden="true" />
          复制幂等键
        </Button>
        {task?.state === 'failed' && task.operation === 'node.inspect' && (
          <Button
            variant="secondary"
            loading={busy}
            disabled={!fresh || loading || session.user.role === 'viewer'}
            onClick={recheck}
          >
            重新检查节点
          </Button>
        )}
      </div>
      {task?.state === 'failed' && (
        <p className="text-(length:--text-xs) text-text-secondary">
          {session.user.role === 'viewer'
            ? '只读用户不能提交检查任务。'
            : '重新检查会创建独立的只读任务，原失败记录保留。节点需要在截止前恢复连接才能执行。'}
        </p>
      )}
    </div>
  );
}
