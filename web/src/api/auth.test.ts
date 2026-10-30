import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSession, login, logout } from './auth';

const session = {
  user: { id: 'test-user', username: 'operator', role: 'operator' as const },
  csrf_token: 'test-csrf',
  expires_at: '2030-01-01T00:00:00Z',
};

beforeEach(() => vi.stubGlobal('location', { origin: 'http://localhost' }));
afterEach(() => vi.unstubAllGlobals());

function respond(status: number, body: unknown = {}) {
  const requests: Request[] = [];
  const fetcher = vi.fn().mockImplementation(async (request: Request) => {
    requests.push(request.clone());
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetcher);
  return Object.assign(fetcher, { requests });
}

describe('auth API', () => {
  it('distinguishes expired sessions from network failures', async () => {
    respond(401);
    await expect(getSession()).resolves.toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(getSession()).rejects.toThrow('无法连接服务器');
  });

  it('rejects malformed successful session responses', async () => {
    respond(200, {});
    await expect(getSession()).rejects.toThrow('会话无效');
  });

  it('posts credentials and returns the actual server session', async () => {
    const fetcher = respond(200, session);
    await expect(login('operator', 'test-password')).resolves.toEqual(session);
    const request = fetcher.requests[0];
    expect(request.url).toBe('http://localhost/api/v1/auth/login');
    expect(request.method).toBe('POST');
    expect(await request.json()).toEqual({ username: 'operator', password: 'test-password' });
  });

  it('sends CSRF with logout and preserves failures', async () => {
    const fetcher = respond(403);
    await expect(logout(session)).rejects.toThrow();
    const request = fetcher.requests[0];
    expect(request.url).toBe('http://localhost/api/v1/auth/logout');
    expect(request.method).toBe('POST');
    expect(request.headers.get('X-CSRF-Token')).toBe(session.csrf_token);
  });
});
