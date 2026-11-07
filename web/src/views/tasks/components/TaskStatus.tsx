import { taskStates } from '@/api/node-tasks';
import { Button } from '@/components/arc/button/button';
import { Tooltip } from '@/components/arc/tooltip/tooltip';
import { taskNote } from '../task-display';

export default function TaskStatus({ state, errorCode }: { state: string; errorCode: string }) {
  const tone =
    state === 'succeeded'
      ? 'text-success'
      : state === 'failed'
        ? 'text-danger'
        : ['dispatched', 'accepted', 'running'].includes(state)
          ? 'text-accent'
          : 'text-text-secondary';
  const status = (
    <span className={`inline-flex items-center gap-2 whitespace-nowrap ${tone}`}>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      {taskStates[state] ?? '未知状态'}
    </span>
  );
  if (state !== 'failed') return status;
  return (
    <Tooltip content={taskNote({ state, error_code: errorCode })}>
      <Button variant="ghost" aria-label="查看任务失败原因">
        {status}
      </Button>
    </Tooltip>
  );
}
