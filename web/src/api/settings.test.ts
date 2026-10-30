import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { changePassword, restoreBackup, saveSettings } from './settings';
import { acceptInvitation, inviteUser } from './users';

const session = {
  user: { id: 'test', username: 'test', role: 'admin' as const },
  csrf_token: 'test-csrf',
  expires_at: '2030-01-01T00:00:00Z',
};
beforeEach(() => vi.stubGlobal('location', { origin: 'http://localhost' }));
afterEach(() => vi.unstubAllGlobals());
it('sends revision and CSRF and preserves concurrent update failures', async () => {
  let captured: Request | undefined;
  vi.stubGlobal('fetch', async (request: Request) => {
    captured = request.clone();
    return Response.json(
      { code: 'conflict', message: '资源状态冲突，请刷新后重试' },
      { status: 409 },
    );
  });
  const settings = {
    revision: 7,
    panel_name: 'Test',
    public_origin: 'https://panel.example.com',
    theme: 'dark' as const,
    sse: true,
    alerts: true,
    auto_backup: true,
    telemetry: false,
  };
  await expect(saveSettings(session, settings)).rejects.toMatchObject({ status: 409 });
  expect(captured?.headers.get('X-CSRF-Token')).toBe('test-csrf');
  expect(await captured?.json()).toEqual(settings);
});
it('submits passwords only in the authenticated body and accepts 204', async () => {
  let captured: Request | undefined;
  vi.stubGlobal('fetch', async (request: Request) => {
    captured = request.clone();
    return new Response(null, { status: 204 });
  });
  await expect(changePassword(session, 'old-password', 'new-password')).resolves.toBeUndefined();
  expect(captured?.url).toBe('http://localhost/api/v1/auth/password');
  expect(await captured?.json()).toEqual({
    current_password: 'old-password',
    new_password: 'new-password',
  });
});
it('reports a scheduled restore as pending restart', async () => {
  vi.stubGlobal('fetch', async () =>
    Response.json({ state: 'pending_restart', id: 'snapshot' }, { status: 202 }),
  );
  await expect(restoreBackup(session, 'snapshot', 'test-password')).resolves.toEqual({
    state: 'pending_restart',
    id: 'snapshot',
  });
});
it('handles one-time invitations without credentials in URLs', async () => {
  const requests: Request[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    requests.push(request.clone());
    return request.url.endsWith('accept-invitation')
      ? new Response(null, { status: 204 })
      : Response.json(
          { id: 'id', token: 'one-time-token', expires_at: '2030-01-01T00:00:00Z' },
          { status: 201 },
        );
  });
  const invitation = await inviteUser(session, 'lin', 'lin@example.com', 'viewer');
  await acceptInvitation(invitation.token, 'new-password');
  expect(requests[0].headers.get('X-CSRF-Token')).toBe('test-csrf');
  expect(requests[1].url).toBe('http://localhost/api/v1/auth/accept-invitation');
  expect(await requests[1].json()).toEqual({ token: 'one-time-token', password: 'new-password' });
});
