import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { listNodes, nodeState } from './nodes';

const node = {
  id: 'node-1',
  name: '东京',
  kind: 'nat',
  state: 'pending',
  last_seen_at: '',
  os: '',
  arch: '',
  agent_version: '',
};
beforeEach(() => vi.stubGlobal('location', { origin: 'http://localhost' }));
afterEach(() => vi.unstubAllGlobals());
it('reads real node fields and sends the exclusive pagination cursor', async () => {
  let url: URL | undefined;
  vi.stubGlobal('fetch', async (request: Request) => {
    url = new URL(request.url);
    return Response.json({ items: [node] });
  });
  expect(await listNodes('previous')).toEqual([node]);
  expect(url?.pathname).toBe('/api/v1/nodes');
  expect(url?.searchParams.get('after')).toBe('previous');
  expect(url?.searchParams.get('limit')).toBe('50');
  expect(nodeState(node.state)).toBe('待连接');
  expect(nodeState('unexpected')).toBe('未知');
});
it.each([
  null,
  {},
  { items: null },
  { items: [{ ...node, id: '' }] },
  { items: [{ ...node, last_seen_at: 'invalid' }] },
])('rejects malformed responses rather than reporting an empty inventory', async (body) => {
  vi.stubGlobal('fetch', async () => Response.json(body));
  await expect(listNodes()).rejects.toMatchObject({ kind: 'invalid-response' });
});
it('distinguishes an empty inventory from an unauthorized request', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ items: [] }));
  expect(await listNodes()).toEqual([]);
  vi.stubGlobal('fetch', async () => Response.json({ code: 'unauthorized' }, { status: 401 }));
  await expect(listNodes()).rejects.toMatchObject({ status: 401 });
});
