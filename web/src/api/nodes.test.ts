import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getNode, listNodes, nodeState } from './nodes';

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
  expect(nodeState(node.state)).toBe('待注册');
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
it('reads persisted distribution and dual-stack inventory', async () => {
  const inventory = {
    sampled_at: '2026-10-31T08:00:00Z',
    os_id: 'debian',
    os_name: 'Debian GNU/Linux 12',
    os_version: '12',
    public_ipv4: '8.8.8.8',
    public_ipv6: '',
    errors: ['public_ipv6_unavailable'],
  };
  vi.stubGlobal('fetch', async () => Response.json({ items: [{ ...node, inventory }] }));
  expect((await listNodes())[0].inventory).toEqual(inventory);
});
it.each([null, { os_name: 'Debian' }, { sampled_at: 'invalid' }])(
  'rejects malformed asset snapshots',
  async (inventory) => {
    vi.stubGlobal('fetch', async () => Response.json({ items: [{ ...node, inventory }] }));
    await expect(listNodes()).rejects.toMatchObject({ kind: 'invalid-response' });
  },
);

it('reads a single node directly and rejects another node identity', async () => {
  let path = '';
  vi.stubGlobal('fetch', async (request: Request) => {
    path = new URL(request.url).pathname;
    return Response.json(node);
  });
  expect(await getNode(node.id)).toEqual(node);
  expect(path).toBe('/api/v1/nodes/node-1');
  await expect(getNode('other')).rejects.toMatchObject({ kind: 'invalid-response' });
});
it('preserves missing, unauthorized and malformed response errors', async () => {
  for (const status of [401, 403, 404, 500]) {
    vi.stubGlobal('fetch', async () => Response.json({ code: 'error' }, { status }));
    await expect(getNode(node.id)).rejects.toMatchObject({ status });
  }
  vi.stubGlobal('fetch', async () => Response.json({ id: node.id }));
  await expect(getNode(node.id)).rejects.toMatchObject({ kind: 'invalid-response' });
});
