import { ApiError, apiRequest } from '@/api/client';

export interface Session {
  user: { id: string; username: string; role: 'admin' | 'operator' | 'viewer' };
  csrf_token: string;
  expires_at: string;
}

export async function login(username: string, password: string): Promise<Session> {
  try {
    return readSession(
      await apiRequest<unknown>('/auth/login', {
        method: 'POST',
        json: { username, password },
      }),
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      throw new ApiError(
        '用户名或密码不正确，请重新输入。',
        'http',
        401,
        error.code,
        error.requestId,
      );
    }
    throw error;
  }
}

function readSession(value: unknown): Session {
  const session = value as Partial<Session> | null;
  if (
    !session ||
    typeof session !== 'object' ||
    typeof session.user?.id !== 'string' ||
    !session.user.id ||
    typeof session.user.username !== 'string' ||
    !session.user.username ||
    !['admin', 'operator', 'viewer'].includes(session.user.role) ||
    typeof session.csrf_token !== 'string' ||
    !session.csrf_token ||
    typeof session.expires_at !== 'string' ||
    !Number.isFinite(Date.parse(session.expires_at))
  ) {
    throw new ApiError('服务器返回的会话无效，请联系管理员。', 'invalid-response');
  }
  return session as Session;
}

export async function logout(session: Session): Promise<void> {
  await apiRequest('/auth/logout', {
    method: 'POST',
    csrfToken: session.csrf_token,
    responseType: 'void',
  });
}

export async function getSession(signal?: AbortSignal): Promise<Session | null> {
  try {
    return readSession(await apiRequest<unknown>('/auth/session', { signal }));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}
