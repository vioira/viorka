import type { Session } from './auth';
import { ApiError, apiRequest } from './client';

export type RegistrationToken = {
  id: string;
  name: string;
  kind: 'vps' | 'nat';
  name_prefix: string;
  max_uses: number;
  used_count: number;
  created_by: string;
  created_at: string;
  expires_at: string;
  revoked_at?: string;
};
export type RegistrationOptions = Pick<
  RegistrationToken,
  'name' | 'kind' | 'name_prefix' | 'max_uses'
> & { expires_in_hours: number };
export type RegistrationSecret = RegistrationToken & { token: string };
export type RegistrationRecord = {
  id: string;
  node_id: string;
  name: string;
  state: string;
  created_at: string;
};
export const REGISTRATION_PAGE_SIZE = 20;
function invalid(): never {
  throw new ApiError('批量注册数据格式无效，请刷新重试。', 'invalid-response');
}
function parseToken(value: unknown): RegistrationToken {
  if (!value || typeof value !== 'object') return invalid();
  const v = value as RegistrationToken;
  if (
    ['id', 'name', 'name_prefix', 'created_by', 'created_at', 'expires_at'].some(
      (key) => typeof (value as Record<string, unknown>)[key] !== 'string',
    ) ||
    !v.id ||
    !['vps', 'nat'].includes(v.kind) ||
    !Number.isInteger(v.max_uses) ||
    v.max_uses < 1 ||
    v.max_uses > 10000 ||
    !Number.isInteger(v.used_count) ||
    v.used_count < 0 ||
    v.used_count > v.max_uses ||
    !Number.isFinite(Date.parse(v.expires_at)) ||
    !Number.isFinite(Date.parse(v.created_at)) ||
    (v.revoked_at !== undefined &&
      (typeof v.revoked_at !== 'string' || !Number.isFinite(Date.parse(v.revoked_at))))
  )
    return invalid();
  // Never retain unexpected secret fields from a list response.
  return {
    id: v.id,
    name: v.name,
    kind: v.kind,
    name_prefix: v.name_prefix,
    created_by: v.created_by,
    created_at: v.created_at,
    expires_at: v.expires_at,
    revoked_at: v.revoked_at,
    max_uses: v.max_uses,
    used_count: v.used_count,
  };
}
export function registrationStatus(v: RegistrationToken, now: number): string {
  if (v.revoked_at) return '已撤销';
  if (Date.parse(v.expires_at) <= now) return '已过期';
  if (v.used_count >= v.max_uses) return '配额已用尽';
  return '可注册';
}
export async function listRegistrationTokens(
  after = '',
  signal?: AbortSignal,
): Promise<RegistrationToken[]> {
  const result = await apiRequest<{ items: unknown[] }>('/node-registration-tokens', {
    query: { after, limit: REGISTRATION_PAGE_SIZE },
    signal,
  });
  if (!result || !Array.isArray(result.items)) return invalid();
  return result.items.map(parseToken);
}
export async function createRegistrationToken(
  session: Session,
  options: RegistrationOptions,
): Promise<RegistrationSecret> {
  const result = await apiRequest<RegistrationSecret>('/node-registration-tokens', {
    method: 'POST',
    csrfToken: session.csrf_token,
    json: options,
  });
  const record = parseToken(result);
  if (!/^[a-f0-9]{64}$/.test(result.token)) return invalid();
  return { ...record, token: result.token };
}
export async function revokeRegistrationToken(session: Session, id: string): Promise<void> {
  await apiRequest(`/node-registration-tokens/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    csrfToken: session.csrf_token,
    responseType: 'void',
  });
}
export async function listRegistrationRecords(
  id: string,
  after = '',
  signal?: AbortSignal,
): Promise<RegistrationRecord[]> {
  const result = await apiRequest<{ items: unknown[] }>(
    `/node-registration-tokens/${encodeURIComponent(id)}/nodes`,
    { query: { after, limit: REGISTRATION_PAGE_SIZE }, signal },
  );
  if (!result || !Array.isArray(result.items)) return invalid();
  return result.items.map((value) => {
    if (!value || typeof value !== 'object') return invalid();
    const v = value as RegistrationRecord;
    if (
      ['id', 'node_id', 'name', 'state', 'created_at'].some(
        (key) => typeof (value as Record<string, unknown>)[key] !== 'string',
      ) ||
      !v.id ||
      !Number.isFinite(Date.parse(v.created_at))
    )
      return invalid();
    return v;
  });
}
