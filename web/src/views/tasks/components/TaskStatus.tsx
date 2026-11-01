import { taskStates } from '@/api/node-tasks';
export default function TaskStatus({ state }: { state: string }) {
  const tone =
    state === 'succeeded'
      ? 'text-success'
      : state === 'failed'
        ? 'text-danger'
        : ['dispatched', 'accepted', 'running'].includes(state)
          ? 'text-accent'
          : 'text-text-secondary';
  return (
    <span className={`inline-flex items-center gap-2 whitespace-nowrap ${tone}`}>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      {taskStates[state] ?? '未知状态'}
    </span>
  );
}
