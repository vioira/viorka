import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Session } from './auth';
import { inspectNode, listNodeTasks, revokeNode } from './node-tasks';

const task = {
  id: 'task-1',
  node_id: 'node-1',
  operation: 'node.inspect',
  state: 'queued',
  attempt: 0,
  deadline_at: '2026-10-31T12:00:00Z',
};
const session = {
  csrf_token: 'test-csrf',
  user: { id: 'user', username: 'admin', role: 'admin' },
} as Session;
beforeEach(() => vi.stubGlobal('location', { origin: 'http://localhost' }));
afterEach(() => vi.unstubAllGlobals());
it('uses node scope, bounded pagination and rejects cross-node responses', async () => {
  let url: URL | undefined;
  vi.stubGlobal('fetch', async (request: Request) => {
    url = new URL(request.url);
    return Response.json({ items: [task] });
  });
  expect(await listNodeTasks('node-1', 'previous')).toEqual([task]);
  expect(url?.pathname).toBe('/api/v1/nodes/node-1/tasks');
  expect(url?.searchParams.get('limit')).toBe('50');
  expect(url?.searchParams.get('after')).toBe('previous');
  await expect(listNodeTasks('other')).rejects.toMatchObject({ kind: 'invalid-response' });
});
it('submits typed inspect with CSRF and caller-owned idempotency key', async () => {
  const requests: Request[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    requests.push(request.clone());
    return Response.json(task, { status: 202 });
  });
  expect((await inspectNode('node-1', session, 'retry-key')).state).toBe('queued');
  await inspectNode('node-1', session, 'retry-key');
  for (const request of requests) {
    expect(request.method).toBe('POST');
    expect(request.headers.get('X-CSRF-Token')).toBe('test-csrf');
    expect(await request.json()).toEqual({
      operation: 'node.inspect',
      idempotency_key: 'retry-key',
    });
  }
});
it('revokes through the authenticated endpoint and propagates permission failures', async () => {
  let request: Request | undefined;
  vi.stubGlobal('fetch', async (value: Request) => {
    request = value;
    return new Response(null, { status: 204 });
  });
  await revokeNode('node-1', session);
  if (!request) throw new Error('Request was not sent');
  expect(new URL(request.url).pathname).toBe('/api/v1/nodes/node-1/revoke');
  expect(request?.headers.get('X-CSRF-Token')).toBe('test-csrf');
  vi.stubGlobal('fetch', async () => Response.json({ code: 'forbidden' }, { status: 403 }));
  await expect(revokeNode('node-1', session)).rejects.toMatchObject({ status: 403 });
});
it.each([null, {}, { items: [null] }, { items: [{ ...task, attempt: -1 }] }])(
  'rejects malformed task lists',
  async (data) => {
    vi.stubGlobal('fetch', async () => Response.json(data));
    await expect(listNodeTasks('node-1')).rejects.toMatchObject({ kind: 'invalid-response' });
  },
);
