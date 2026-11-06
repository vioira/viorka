import { ApiError, apiRequest } from './client';

export const taskFilters = [
  { value: 'all', label: '全部' },
  { value: 'queued', label: '排队中' },
  { value: 'succeeded', label: '成功' },
  { value: 'failed', label: '失败' },
];
export type TaskRecord = {
  id: string;
  node_id: string;
  node_name: string;
  operation: string;
  operation_name: string;
  idempotency_key: string;
  state: string;
  attempt: number;
  max_attempts: number;
  created_at: string;
  updated_at: string;
  deadline_at: string;
  error_code: string;
  result: unknown;
};
export type TaskPage = { items: TaskRecord[]; next_cursor: string };
export type TaskSummary = {
  since: string;
  until: string;
  total: number;
  succeeded: number;
  failed: number;
  active: number;
  success_rate: number | null;
};
const timestamp = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function invalid(): never {
  throw new ApiError('任务响应格式无效，请刷新重试。', 'invalid-response');
}
function parseTask(value: unknown): TaskRecord {
  if (!value || typeof value !== 'object') return invalid();
  const task = value as TaskRecord;
  if (
    ![
      'id',
      'node_id',
      'node_name',
      'operation',
      'operation_name',
      'idempotency_key',
      'state',
      'error_code',
    ].every((key) => typeof (task as Record<string, unknown>)[key] === 'string') ||
    !task.id ||
    !task.node_id ||
    !task.operation ||
    !task.operation_name ||
    !task.idempotency_key ||
    !count(task.attempt) ||
    !count(task.max_attempts) ||
    task.max_attempts < 1 ||
    !timestamp(task.created_at) ||
    !timestamp(task.updated_at) ||
    !timestamp(task.deadline_at) ||
    !Object.hasOwn(task, 'result')
  )
    return invalid();
  return task;
}
export async function listTasks(
  state = 'all',
  after = '',
  signal?: AbortSignal,
): Promise<TaskPage> {
  const result = await apiRequest<TaskPage>('/tasks', {
    query: { state, after, limit: 50 },
    signal,
  });
  if (!result || !Array.isArray(result.items) || typeof result.next_cursor !== 'string')
    return invalid();
  const items = result.items.map(parseTask);
  if (
    new Set(items.map((task) => task.id)).size !== items.length ||
    (result.next_cursor && result.next_cursor !== items.at(-1)?.id)
  )
    return invalid();
  return { items, next_cursor: result.next_cursor };
}
export async function getTask(id: string, signal?: AbortSignal): Promise<TaskRecord> {
  const task = parseTask(await apiRequest(`/tasks/${id}`, { signal }));
  if (task.id !== id) return invalid();
  return task;
}
export async function getTaskSummary(signal?: AbortSignal): Promise<TaskSummary> {
  const summary = await apiRequest<TaskSummary>('/tasks/summary', { signal });
  if (
    !summary ||
    !timestamp(summary.since) ||
    !timestamp(summary.until) ||
    ![summary.total, summary.succeeded, summary.failed, summary.active].every(count) ||
    summary.succeeded + summary.failed > summary.total ||
    (summary.success_rate !== null &&
      (typeof summary.success_rate !== 'number' ||
        !Number.isFinite(summary.success_rate) ||
        summary.success_rate < 0 ||
        summary.success_rate > 100)) ||
    (summary.succeeded + summary.failed === 0) !== (summary.success_rate === null)
  )
    return invalid();
  return summary;
}
