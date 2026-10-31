import { ApiError, apiRequest } from './client';
export type AuditRecord = {
  id: string;
  kind: 'user' | 'system';
  actor: string;
  action: string;
  target: string;
  ip: string;
  time: string;
};
type AuditDTO = {
  id: string;
  kind: 'user' | 'system';
  actor_id: string;
  actor: string;
  action: string;
  resource_type: string;
  resource_id: string;
  source_ip: string;
  created_at: string;
};
const actions: Record<string, string> = {
  'node.create': '创建节点',
  'node.enrollment.revoke': '吊销注册令牌',
  'node.revoke': '吊销节点身份',
  'node.settings.update': '更新节点设置',
  'task.create': '提交节点任务',
  'settings.update': '更新系统设置',
  'password.change': '修改密码',
  'sessions.revoke': '吊销会话',
  'user.invite': '创建用户邀请',
  'invitation.accept': '接受用户邀请',
  'user.remove': '移除用户',
  'user.role': '更改用户角色',
};
export async function listAuditLogs(kind: string, after = '', signal?: AbortSignal) {
  const result = await apiRequest<{ items: AuditDTO[]; next_cursor: string }>('/audit-logs', {
    query: { kind, after, limit: 50 },
    signal,
  });
  if (
    !result ||
    !Array.isArray(result.items) ||
    typeof result.next_cursor !== 'string' ||
    !result.items.every(
      (v) =>
        v &&
        [
          'id',
          'actor_id',
          'actor',
          'action',
          'resource_type',
          'resource_id',
          'source_ip',
          'created_at',
        ].every((key) => typeof v[key as keyof AuditDTO] === 'string') &&
        v.id &&
        (v.kind === 'user' || v.kind === 'system') &&
        Number.isFinite(Date.parse(v.created_at)),
    )
  ) {
    throw new ApiError('审计日志响应格式无效，请联系管理员。', 'invalid-response');
  }
  return {
    nextCursor: result.next_cursor,
    items: result.items.map(
      (v): AuditRecord => ({
        id: v.id,
        kind: v.kind,
        actor: v.actor || v.actor_id || '系统',
        action: actions[v.action] ?? v.action,
        target: [v.resource_type, v.resource_id].filter(Boolean).join(' / '),
        ip: v.source_ip || '未记录',
        time: v.created_at,
      }),
    ),
  };
}
