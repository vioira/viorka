import type { Session } from './auth';
import { ApiError, apiRequest } from './client';

export type NodeTask = {
  id: string;
  node_id: string;
  operation: string;
  operation_name: string;
  state: string;
  error_code: string;
  attempt: number;
  deadline_at: string;
};
export const taskStates: Record<string, string> = {
  queued: '排队中',
  dispatched: '已派发',
  accepted: '已接收',
  running: '执行中',
  succeeded: '已完成',
  failed: '失败',
  canceled: '已取消',
  cancelled: '已取消',
  rolled_back: '已回滚',
};
function parseTask(value: unknown, nodeId: string): NodeTask {
  const task = value as NodeTask | null;
  if (
    !task ||
    task.node_id !== nodeId ||
    !task.id ||
    !task.operation_name ||
    !['id', 'node_id', 'operation', 'operation_name', 'state', 'error_code', 'deadline_at'].every(
      (key) => typeof (task as unknown as Record<string, unknown>)[key] === 'string',
    ) ||
    !Number.isInteger(task.attempt) ||
    task.attempt < 0 ||
    !Number.isFinite(Date.parse(task.deadline_at))
  )
    throw new ApiError('任务数据格式无效，请刷新重试。', 'invalid-response');
  return task;
}
export async function listNodeTasks(id: string, after = '', signal?: AbortSignal) {
  const data = await apiRequest<{ items?: unknown }>(`/nodes/${id}/tasks`, {
    query: { limit: 50, after },
    signal,
  });
  if (!data || !Array.isArray(data.items))
    throw new ApiError('任务列表格式无效，请刷新重试。', 'invalid-response');
  return data.items.map((task) => parseTask(task, id));
}
export async function inspectNode(id: string, session: Session, key: string) {
  return parseTask(
    await apiRequest(`/nodes/${id}/tasks`, {
      method: 'POST',
      csrfToken: session.csrf_token,
      json: { operation: 'node.inspect', idempotency_key: key },
    }),
    id,
  );
}
export async function revokeNode(id: string, session: Session) {
  await apiRequest(`/nodes/${id}/revoke`, {
    method: 'POST',
    csrfToken: session.csrf_token,
    responseType: 'void',
  });
}
