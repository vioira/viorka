import type { Session } from './auth';
import { apiRequest } from './client';
import type { EngineRouting } from './outbounds';
export interface EngineService {
  preset_id?: string;
  port_override?: number;
  sni_override?: string;
  id: string;
  name: string;
  enabled: boolean;
  pending_delete: boolean;
  listen_host: string;
  listen_port: number;
  target_host: string;
  target_port: number;
  server_name: string;
  public_host: string;
  public_port: number;
}
export interface EngineDraft {
  routing?: EngineRouting;
  version: number;
  services: EngineService[];
  updated_by: string;
  updated_at: string;
}
export interface EngineRecord {
  sync_state?: string;
  sync_error?: string;
  id: string;
  node_id: string;
  name: string;
  version: string;
  ownership: string;
  status: string;
  observed_at: string;
  run_intent: string;
  desired_revision: number;
  observed_revision: number;
  external_connectivity: string;
  draft: EngineDraft;
}
export interface Connection {
  service_id: string;
  name: string;
  url: string;
  revision: number;
  runtime_status: string;
  external_connectivity: string;
}
export const engineNames = ['sing-box', 'xray', 'realm'] as const;
export const listEngines = (node: string, signal?: AbortSignal) =>
  apiRequest<{ items: EngineRecord[] }>(`/nodes/${node}/engines`, { signal });
export const saveDraft = (id: string, draft: EngineDraft, session: Session) =>
  apiRequest<EngineDraft>(`/engines/${id}/draft`, {
    method: 'PUT',
    csrfToken: session.csrf_token,
    json: { version: draft.version, services: draft.services, routing: draft.routing },
  });
export const installEngine = (node: string, name: string, key: string, session: Session) =>
  apiRequest<{ id: string }>(`/nodes/${node}/engines`, {
    method: 'POST',
    csrfToken: session.csrf_token,
    json: { name, idempotency_key: key, confirm: true },
  });
export const engineAction = (
  engine: EngineRecord,
  operation: string,
  key: string,
  session: Session,
  options: {
    allow_unreachable?: boolean;
    restore_previous?: boolean;
    delete_services?: boolean;
    rotate_service_id?: string;
  } = {},
) =>
  apiRequest<{ id: string }>(`/engines/${engine.id}/actions`, {
    method: 'POST',
    csrfToken: session.csrf_token,
    json: {
      operation,
      version: engine.version,
      draft_version: engine.draft.version,
      idempotency_key: key,
      confirm: true,
      ...options,
    },
  });
export const engineConnections = (id: string, session: Session) =>
  apiRequest<Connection[]>(`/engines/${id}/connections`, {
    method: 'POST',
    csrfToken: session.csrf_token,
  });
export function engineStatus(status: string) {
  return (
    (
      {
        not_installed: '未安装',
        installed: '已安装，尚未运行',
        running: '运行中',
        stopped: '已停止',
        unknown: '结果未知，需核对',
        degraded: '异常，需要恢复',
      } as Record<string, string>
    )[status] ?? '状态未知'
  );
}

export const retryEngineSync = (id: string, session: Session) =>
  apiRequest(`/engines/${id}/sync`, {
    responseType: 'void',
    method: 'POST',
    csrfToken: session.csrf_token,
  });
export function engineSyncError(code: string) {
  return (
    (
      {
        engine_port_conflict: '端口冲突，请调整协议端口或节点覆盖后重试。',
        engine_unsupported: '当前引擎不支持目标配置，请调整协议参数。',
        engine_invalid_config: '配置校验失败，请调整协议参数。',
        engine_result_unknown: '执行结果未知，请先核对引擎，再重试同步。',
        deadline_exceeded: '执行超时，请先核对引擎，再重试同步。',
        engine_rollback_failed: '配置回滚失败，请先恢复引擎。',
      } as Record<string, string>
    )[code] ?? '同步失败，请查看任务详情，处理原因后重试。'
  );
}
