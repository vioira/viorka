import type { Session } from './auth';
import { ApiError, apiRequest } from './client';

export interface Enrollment {
  id: string;
  token: string;
  expires_at: string;
}
export type NodeKind = 'vps' | 'nat' | 'relay';

export async function createEnrollment(
  session: Session,
  name: string,
  kind: NodeKind,
): Promise<Enrollment> {
  const value = await apiRequest<Partial<Enrollment> | null>('/nodes', {
    method: 'POST',
    csrfToken: session.csrf_token,
    json: { name: name.trim(), kind },
  });
  if (
    !value ||
    typeof value.id !== 'string' ||
    !/^[a-zA-Z0-9_-]+$/.test(value.id) ||
    typeof value.token !== 'string' ||
    !value.token ||
    typeof value.expires_at !== 'string' ||
    !Number.isFinite(Date.parse(value.expires_at))
  ) {
    throw new ApiError(
      '服务器返回的令牌信息无效，创建结果未知，请联系管理员。',
      'invalid-response',
    );
  }
  return value as Enrollment;
}

export async function revokeEnrollment(session: Session, id: string): Promise<void> {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new TypeError('Invalid enrollment ID');
  await apiRequest(`/nodes/${id}/enrollment-token`, {
    method: 'DELETE',
    csrfToken: session.csrf_token,
    responseType: 'void',
  });
}
