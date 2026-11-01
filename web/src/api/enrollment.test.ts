import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createEnrollment, renewEnrollment, revokeEnrollment } from './enrollment';

const session = {
  user: { id: 'test', username: 'test', role: 'admin' as const },
  csrf_token: 'test-csrf',
  expires_at: '2030-01-01T00:00:00Z',
};
beforeEach(() => vi.stubGlobal('location', { origin: 'http://localhost' }));
afterEach(() => vi.unstubAllGlobals());
it('creates a node and token with the expected DTO and CSRF protection', async () => {
  let captured: Request | undefined;
  const token = { id: 'token-id', token: 'test-only-token', expires_at: '2030-01-01T00:00:00Z' };
  vi.stubGlobal('fetch', async (request: Request) => {
    captured = request.clone();
    return Response.json(token, { status: 201 });
  });
  expect(await createEnrollment(session, ' test-node ', 'nat')).toEqual(token);
  expect(captured?.method).toBe('POST');
  expect(captured?.url).toBe('http://localhost/api/v1/nodes');
  expect(captured?.headers.get('X-CSRF-Token')).toBe('test-csrf');
  expect(await captured?.json()).toEqual({ name: 'test-node', kind: 'nat' });
});
it('does not retry an unknown creation outcome or accept malformed success', async () => {
  const fetcher = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
  vi.stubGlobal('fetch', fetcher);
  await expect(createEnrollment(session, 'test', 'vps')).rejects.toThrow('无法连接服务器');
  expect(fetcher).toHaveBeenCalledTimes(1);
  vi.stubGlobal('fetch', async () => Response.json({}));
  await expect(createEnrollment(session, 'test', 'vps')).rejects.toThrow('创建结果未知');
});
it('preserves forbidden revocation and accepts only successful completion', async () => {
  let captured: Request | undefined;
  vi.stubGlobal('fetch', async (request: Request) => {
    captured = request.clone();
    return Response.json({ code: 'forbidden' }, { status: 403 });
  });
  await expect(revokeEnrollment(session, 'token-id')).rejects.toMatchObject({ status: 403 });
  expect(captured?.method).toBe('DELETE');
  expect(captured?.url).toBe('http://localhost/api/v1/nodes/token-id/enrollment-token');
  expect(captured?.headers.get('X-CSRF-Token')).toBe('test-csrf');
  vi.stubGlobal('fetch', async () => new Response(null, { status: 204 }));
  await expect(revokeEnrollment(session, 'token-id')).resolves.toBeUndefined();
  await expect(revokeEnrollment(session, '../other')).rejects.toThrow('Invalid enrollment ID');
});

const enrollment = { id: 'node-1', token: 'a'.repeat(64), expires_at: '2026-11-01T12:00:00Z' };
it('renews the existing node using CSRF and validates the returned identity', async () => {
  let sent: Request | undefined;
  vi.stubGlobal('fetch', async (request: Request) => {
    sent = request;
    return Response.json(enrollment, { status: 201 });
  });
  expect(await renewEnrollment(session, 'node-1')).toEqual(enrollment);
  if (!sent) throw new Error('Request was not sent');
  expect(new URL(sent.url).pathname).toBe('/api/v1/nodes/node-1/enrollment-token');
  expect(sent.method).toBe('POST');
  expect(sent.headers.get('X-CSRF-Token')).toBe('test-csrf');
  await expect(renewEnrollment(session, 'other')).rejects.toMatchObject({
    kind: 'invalid-response',
  });
});
it('propagates an already registered conflict', async () => {
  vi.stubGlobal('fetch', async () =>
    Response.json({ code: 'conflict', message: '已注册' }, { status: 409 }),
  );
  await expect(renewEnrollment(session, 'node-1')).rejects.toMatchObject({ status: 409 });
});

it('uses the explicit identity reset endpoint only after confirmation', async () => {
  let sent: Request | undefined;
  vi.stubGlobal('fetch', async (request: Request) => {
    sent = request;
    return Response.json(enrollment, { status: 201 });
  });
  await renewEnrollment(session, 'node-1', true);
  expect(sent?.url).toBe('http://localhost/api/v1/nodes/node-1/reenrollment');
  expect(sent?.headers.get('X-CSRF-Token')).toBe('test-csrf');
});
