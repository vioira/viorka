import { ApiError, apiRequest } from './client';
import { parseTask } from './node-tasks';

export interface AgentRelease {
  version: string;
  sha256: string;
}
export interface AgentUpdateStatus {
  auto_update: boolean;
  capable: boolean;
  online: boolean;
  current_version: string;
  target?: AgentRelease;
  checked_at?: string;
  available: boolean;
  active_task?: string;
}

function parseStatus(value: unknown): AgentUpdateStatus {
  const s = value as AgentUpdateStatus | null;
  if (
    !s ||
    ![s.auto_update, s.capable, s.online, s.available].every((flag) => typeof flag === 'boolean') ||
    typeof s.current_version !== 'string' ||
    (s.checked_at !== undefined && !Number.isFinite(Date.parse(s.checked_at))) ||
    (s.target !== undefined &&
      (!s.target ||
        typeof s.target.version !== 'string' ||
        !/^[a-f0-9]{64}$/.test(s.target.sha256))) ||
    (s.available && !s.target) ||
    (s.active_task !== undefined && typeof s.active_task !== 'string')
  ) {
    throw new ApiError('Agent 更新状态格式无效，请刷新重试。', 'invalid-response');
  }
  return s;
}
const path = (id: string) => `/nodes/${encodeURIComponent(id)}/agent-update`;
export const readAgentUpdate = async (id: string, signal: AbortSignal) =>
  parseStatus(await apiRequest(path(id), { signal }));
export const saveAgentPolicy = async (id: string, enabled: boolean, csrfToken: string) =>
  parseStatus(
    await apiRequest(path(id), { method: 'PUT', json: { auto_update: enabled }, csrfToken }),
  );
export const submitAgentUpdate = async (id: string, target: AgentRelease, csrfToken: string) =>
  parseTask(await apiRequest(path(id), { method: 'POST', json: target, csrfToken }), id);
