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
  action_label: string;
  resource_type: string;
  resource_id: string;
  source_ip: string;
  created_at: string;
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
          'action_label',
          'resource_type',
          'resource_id',
          'source_ip',
          'created_at',
        ].every((key) => typeof v[key as keyof AuditDTO] === 'string') &&
        v.id &&
        v.action_label.trim() &&
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
        action: v.action_label,
        target: [v.resource_type, v.resource_id].filter(Boolean).join(' / '),
        ip: v.source_ip || '未记录',
        time: v.created_at,
      }),
    ),
  };
}
