import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Session } from './auth';
import { deleteNode, getNode, listAllNodes, listNodes, nodeRegion, nodeState } from './nodes';

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

it('deletes a node with CSRF and accepts an empty 204 response', async () => {
  let sent: Request | undefined;
  vi.stubGlobal('fetch', async (request: Request) => {
    sent = request;
    return new Response(null, { status: 204 });
  });
  await expect(deleteNode(node.id, { csrf_token: 'csrf' } as Session)).resolves.toBeUndefined();
  expect(sent?.method).toBe('DELETE');
  expect(sent && new URL(sent.url).pathname).toBe('/api/v1/nodes/node-1');
  expect(sent?.headers.get('X-CSRF-Token')).toBe('csrf');
});

it.each([401, 403, 404, 409, 503])('preserves deletion failures (%s)', async (status) => {
  vi.stubGlobal('fetch', async () =>
    Response.json({ code: 'node_tasks_active', message: '请先处理任务' }, { status }),
  );
  await expect(deleteNode(node.id, { csrf_token: 'csrf' } as Session)).rejects.toMatchObject({
    status,
    message: '请先处理任务',
  });
});

it('automatically reads every page, including the final empty page for exact multiples', async () => {
  const page = Array.from({ length: 50 }, (_, i) => ({ ...node, id: `node-${i}` }));
  const cursors: string[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    const after = new URL(request.url).searchParams.get('after') ?? '';
    cursors.push(after);
    return Response.json({ items: after ? [] : page });
  });
  expect(await listAllNodes()).toEqual(page);
  expect(cursors).toEqual(['', 'node-49']);
});

it('includes a short final page and rejects a failed later page', async () => {
  const page = Array.from({ length: 50 }, (_, i) => ({ ...node, id: `node-${i}` }));
  vi.stubGlobal('fetch', async (request: Request) =>
    Response.json({
      items: new URL(request.url).searchParams.get('after') ? [{ ...node, id: 'last' }] : page,
    }),
  );
  expect((await listAllNodes()).map((item) => item.id)).toEqual([
    ...page.map((item) => item.id),
    'last',
  ]);
  vi.stubGlobal('fetch', async (request: Request) =>
    new URL(request.url).searchParams.get('after')
      ? Response.json({ code: 'forbidden' }, { status: 403 })
      : Response.json({ items: page }),
  );
  await expect(listAllNodes()).rejects.toMatchObject({ status: 403 });
});

it('rejects repeated cursors and respects cancellation', async () => {
  const page = Array.from({ length: 50 }, (_, i) => ({ ...node, id: `node-${i}` }));
  vi.stubGlobal('fetch', async () => Response.json({ items: page }));
  await expect(listAllNodes()).rejects.toMatchObject({ kind: 'invalid-response' });
  const controller = new AbortController();
  controller.abort();
  await expect(listAllNodes(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
});

it('reads and displays persisted IP locations without inventing missing cities', async () => {
  const location = { country_code: 'JP', subdivision: '东京都', city: '东京' };
  vi.stubGlobal('fetch', async () => Response.json({ ...node, location }));
  expect((await getNode(node.id)).location).toEqual(location);
  expect(nodeRegion(location)).toBe('🇯🇵日本东京');
  expect(nodeRegion({ country_code: 'JP', subdivision: '大阪府', city: '大阪' })).toBe(
    '🇯🇵日本大阪',
  );
  expect(nodeRegion({ country_code: 'CN', subdivision: '浙江', city: '杭州' })).toBe('🇨🇳中国杭州');
  expect(nodeRegion({ country_code: 'CN', subdivision: '浙江', city: '' })).toBe('🇨🇳中国浙江');
  expect(nodeRegion({ country_code: 'SG', subdivision: '', city: '新加坡' })).toBe('🇸🇬新加坡');
  expect(nodeRegion({ country_code: 'JP', subdivision: '', city: '' })).toBe('🇯🇵日本');
  expect(nodeRegion()).toBe('地区未知');
  expect(nodeRegion({ country_code: '', subdivision: '', city: '' })).toBe('地区未知');
});
it.each([null, { country_code: 'invalid', subdivision: '', city: '' }, { country_code: 'JP' }])(
  'rejects invalid location responses',
  async (location) => {
    vi.stubGlobal('fetch', async () => Response.json({ ...node, location }));
    await expect(getNode(node.id)).rejects.toMatchObject({ kind: 'invalid-response' });
  },
);
