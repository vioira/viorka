import { taskStates } from '@/api/node-tasks';
import type { EngineDiagnostic } from '@/api/task-diagnostics';
import { Tooltip } from '@/components/arc/tooltip/tooltip';
import { taskNote } from '../task-display';

export default function TaskStatus({
  state,
  errorCode,
  diagnostic,
}: {
  state: string;
  errorCode: string;
  diagnostic?: EngineDiagnostic;
}) {
  const tone =
    state === 'succeeded'
      ? 'text-success'
      : state === 'failed'
        ? 'text-danger cursor-help'
        : ['dispatched', 'accepted', 'running'].includes(state)
          ? 'text-accent'
          : 'text-text-secondary';
  const updateErrors: Record<string, string> = {
    update_rolled_back: '已回滚',
    update_rollback_failed: '回滚失败',
    update_result_unknown: '结果未知',
  };
  const status = (
    <span className={`inline-flex items-center gap-2 whitespace-nowrap ${tone}`}>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      {(state === 'failed' && errorCode ? updateErrors[errorCode] : undefined) ??
        taskStates[state] ??
        '未知状态'}
    </span>
  );
  if (state !== 'failed') return status;
  return (
    <Tooltip content={taskNote({ state, error_code: errorCode, diagnostic })}>{status}</Tooltip>
  );
}
