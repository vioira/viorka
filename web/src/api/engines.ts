import type { Session } from './auth';
import { apiRequest } from './client';
import { taskStates } from './node-tasks';
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
  reenrollment_check?: '' | 'pending' | 'unsupported' | 'failed' | 'mismatch';
  published_draft: EngineDraft | null;
  published_revision: number;
  sync_error_message?: string;
  last_error?: string;
  sync_state?: string;
  active_task_state?: string;
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
export type EngineSummary = Omit<
  EngineRecord,
  'draft' | 'published_draft' | 'published_revision'
> & {
  published_revision: number;
  published_enabled_services: number;
  draft_version: number;
  service_count: number;
};
export const getEngine = (id: string, signal?: AbortSignal) =>
  apiRequest<EngineRecord>(`/engines/${encodeURIComponent(id)}`, { signal });
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
  apiRequest<{ items: EngineSummary[] }>(`/nodes/${node}/engines`, { signal });
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
    include_config?: boolean;
    allow_unreachable?: boolean;
    restore_previous?: boolean;
    delete_services?: boolean;
    rotate_service_id?: string;
  } = {},
) =>
  apiRequest<{ id?: string; local_only?: boolean }>(`/engines/${engine.id}/actions`, {
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
        engine_config_unavailable: '配置文件无法读取、超过 32 KiB，或与托管记录不一致。',
        engine_external: '发现第三方实例或资源归属不一致，请核对节点上的引擎归属。',
        engine_port_conflict: '端口冲突，请调整协议端口或节点覆盖后重试。',
        engine_unsupported: '当前引擎不支持目标配置，请调整协议参数。',
        engine_invalid_config: '配置校验失败，请调整协议参数。',
        engine_dependency_missing: '引擎缺少系统依赖。',
        engine_dependency_install_failed: '系统依赖安装失败。',
        engine_binary_unusable: '引擎程序无法执行。',
        engine_result_unknown: '执行结果未知，请先核对引擎，再重试同步。',
        deadline_exceeded: '执行超时，请先核对引擎，再重试同步。',
        engine_rollback_failed: '配置回滚失败，请先恢复引擎。',
      } as Record<string, string>
    )[code] ?? (code ? `同步失败（${code}）` : '同步失败，节点未返回具体原因。')
  );
}

export function engineTaskStatus(engine: Pick<EngineRecord, 'active_task_state'>) {
  const state = engine.active_task_state;
  return state && taskStates[state] ? `任务${taskStates[state]}` : '任务待确认';
}

export function engineRuntimeStatus(
  engine: Omit<EngineRecord, 'draft' | 'published_draft' | 'published_revision'>,
  online = true,
) {
  if (engine.last_error === 'engine_external') return '归属冲突';
  if (engine.reenrollment_check === 'unsupported') return '待核对，Agent 或平台不支持';
  if (engine.reenrollment_check === 'mismatch') {
    return online ? `${engineStatus(engine.status)}，配置待核对` : '节点离线，配置待核对';
  }
  if (engine.reenrollment_check === 'failed') {
    return engine.last_error === 'deadline_exceeded' ? '核对超时，待重试' : '核对失败，待重试';
  }
  if (engine.reenrollment_check) return engine.active_task_state ? '正在核对引擎' : '等待节点核对';
  if (!online) return '节点离线，状态待确认';
  if (engine.sync_state === 'syncing') return engineTaskStatus(engine);
  return engineStatus(engine.status);
}

export function canOperateEngine(engine: EngineRecord) {
  return (
    !engine.reenrollment_check &&
    engine.ownership === 'managed' &&
    engine.last_error !== 'engine_external' &&
    engine.sync_state !== 'syncing' &&
    ['installed', 'running', 'stopped'].includes(engine.status)
  );
}

export interface EngineConfigurationResult {
  task_id: string;
  state: string;
  captured_at: string;
  runtime_status: string;
  error_code: string;
  configuration: { revision: number; files: { name: string; content: string }[] } | null;
}
export const engineConfiguration = (id: string, task: string, signal?: AbortSignal) =>
  apiRequest<EngineConfigurationResult>(
    `/engines/${encodeURIComponent(id)}/configuration/${encodeURIComponent(task)}`,
    { signal },
  );

export interface ManagedEngineRecovery {
  state: string;
  error_code?: string;
  engine_id?: string;
  name: string;
  version?: string;
  status?: string;
  run_intent?: string;
  revision?: number;
  configured: boolean;
  recovered: boolean;
  services: { id: string; name: string; enabled: boolean; listen_port: number }[];
}

const recoveryPath = (node: string) => `/nodes/${encodeURIComponent(node)}/engine-recovery`;

export const startManagedEngineRecovery = (
  node: string,
  name: string,
  key: string,
  session: Session,
) =>
  apiRequest<{ id: string }>(recoveryPath(node), {
    method: 'POST',
    csrfToken: session.csrf_token,
    json: { name, idempotency_key: key },
  });

export const previewManagedEngineRecovery = (node: string, task: string, signal?: AbortSignal) =>
  apiRequest<ManagedEngineRecovery>(`${recoveryPath(node)}/${encodeURIComponent(task)}`, {
    signal,
  });

export const confirmManagedEngineRecovery = (node: string, task: string, session: Session) =>
  apiRequest<{ engine_id: string }>(`${recoveryPath(node)}/${encodeURIComponent(task)}`, {
    method: 'POST',
    csrfToken: session.csrf_token,
    json: { confirm: true },
  });
