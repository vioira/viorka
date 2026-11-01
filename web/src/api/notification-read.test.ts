import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Session } from './auth';
import { markNotificationsRead, setNotificationRead } from './settings';

const session: Session = {
  user: { id: 'viewer', username: 'viewer', role: 'viewer' },
  csrf_token: 'session-csrf',
  expires_at: '2026-11-01T00:00:00Z',
};
beforeEach(() => vi.stubGlobal('location', { origin: 'http://localhost' }));
afterEach(() => vi.unstubAllGlobals());

it.each([true, false])('saves read=%s with CSRF and no caller-selected user', async (read) => {
  vi.stubGlobal('fetch', async (request: Request) => {
    expect(new URL(request.url).pathname).toBe('/api/v1/notifications/notice/read');
    expect(request.method).toBe('PUT');
    expect(request.headers.get('X-CSRF-Token')).toBe('session-csrf');
    expect(await request.json()).toEqual({ read });
    return new Response(null, { status: 204 });
  });
  await expect(setNotificationRead(session, 'notice', read)).resolves.toBeUndefined();
});

it.each([403, 404, 503])('does not report success for HTTP %s', async (status) => {
  vi.stubGlobal('fetch', async () =>
    Response.json({ code: 'failed', message: '保存失败' }, { status }),
  );
  await expect(setNotificationRead(session, 'notice', true)).rejects.toMatchObject({ status });
});

it('marks the entire selected notification window in one request', async () => {
  const ids = Array.from({ length: 100 }, (_, i) => `notice-${i}`);
  const fetch = vi.fn(async (request: Request) => {
    expect(new URL(request.url).pathname).toBe('/api/v1/notifications/read');
    expect(request.method).toBe('PUT');
    expect(request.headers.get('X-CSRF-Token')).toBe('session-csrf');
    expect(await request.json()).toEqual({ ids });
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal('fetch', fetch);
  await expect(markNotificationsRead(session, ids)).resolves.toBeUndefined();
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('propagates a failed batch without falling back to single-item requests', async () => {
  const fetch = vi.fn(async () => Response.json({ code: 'not_found' }, { status: 404 }));
  vi.stubGlobal('fetch', fetch);
  await expect(markNotificationsRead(session, ['a', 'missing'])).rejects.toMatchObject({
    status: 404,
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});
