import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Session } from './auth';
import {
  createRegistrationToken,
  listRegistrationRecords,
  listRegistrationTokens,
  registrationStatus,
  revokeRegistrationToken,
} from './registration';

const token = {
  id: 'batch',
  name: '香港部署',
  kind: 'nat',
  name_prefix: 'hk-',
  max_uses: 2,
  used_count: 0,
  created_by: 'admin',
  created_at: '2026-11-15T00:00:00Z',
  expires_at: '2026-11-16T00:00:00Z',
} as const;
const session = { csrf_token: 'csrf' } as Session;
beforeEach(() => vi.stubGlobal('location', { origin: 'http://localhost' }));
afterEach(() => vi.unstubAllGlobals());
it('creates a bounded batch token using CSRF and never retains a secret in list records', async () => {
  vi.stubGlobal('fetch', async (request: Request) => {
    expect(request.method).toBe('POST');
    expect(request.headers.get('X-CSRF-Token')).toBe('csrf');
    expect(await request.json()).toEqual({
      name: '香港部署',
      kind: 'nat',
      name_prefix: 'hk-',
      max_uses: 2,
      expires_in_hours: 24,
    });
    return Response.json({ ...token, token: 'a'.repeat(64) });
  });
  expect(
    (
      await createRegistrationToken(session, {
        name: '香港部署',
        kind: 'nat',
        name_prefix: 'hk-',
        max_uses: 2,
        expires_in_hours: 24,
      })
    ).token,
  ).toBe('a'.repeat(64));
  vi.stubGlobal('fetch', async (request: Request) => {
    const url = new URL(request.url);
    expect(url.searchParams.get('after')).toBe('previous');
    expect(url.searchParams.get('limit')).toBe('20');
    return Response.json({ items: [{ ...token, token: 'accidental-secret' }] });
  });
  expect(await listRegistrationTokens('previous')).toEqual([{ ...token, revoked_at: undefined }]);
});
it.each([
  null,
  {},
  { items: null },
  { items: [{ ...token, used_count: 3 }] },
  { items: [{ ...token, expires_at: 'bad' }] },
  { items: [{ ...token, expires_at: 2026 }] },
  { items: [{ ...token, revoked_at: null }] },
])('rejects malformed token lists', async (body) => {
  vi.stubGlobal('fetch', async () => Response.json(body));
  await expect(listRegistrationTokens()).rejects.toMatchObject({ kind: 'invalid-response' });
});
it('revokes through the authenticated API without returning a false node state', async () => {
  vi.stubGlobal('fetch', async (request: Request) => {
    expect(request.method).toBe('DELETE');
    expect(request.headers.get('X-CSRF-Token')).toBe('csrf');
    return new Response(null, { status: 204 });
  });
  await revokeRegistrationToken(session, token.id);
  const now = Date.parse('2026-11-15T01:00:00Z');
  expect(registrationStatus(token, now)).toBe('可注册');
  expect(registrationStatus({ ...token, used_count: 2 }, now)).toBe('配额已用尽');
  expect(registrationStatus(token, Date.parse(token.expires_at))).toBe('已过期');
  expect(registrationStatus({ ...token, revoked_at: token.created_at }, now)).toBe('已撤销');
});
it('keeps deleted-node registrations and distinguishes failure from empty results', async () => {
  const record = {
    id: 'record',
    node_id: '',
    name: '',
    state: 'deleted',
    created_at: token.created_at,
  };
  vi.stubGlobal('fetch', async () => Response.json({ items: [record] }));
  expect(await listRegistrationRecords(token.id)).toEqual([record]);
  vi.stubGlobal('fetch', async () => Response.json({ code: 'unavailable' }, { status: 503 }));
  await expect(listRegistrationRecords(token.id)).rejects.toMatchObject({ status: 503 });
});
