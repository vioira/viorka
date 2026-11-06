import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { listAuditLogs } from './audit';

const record = {
  id: 'a',
  kind: 'user',
  actor_id: 'u',
  actor: '管理员',
  action: 'task.create',
  action_label: '提交节点任务',
  resource_type: 'node',
  resource_id: 'n',
  source_ip: '',
  created_at: '2026-10-31T00:00:00Z',
};
beforeEach(() => vi.stubGlobal('location', { origin: 'http://localhost' }));
afterEach(() => vi.unstubAllGlobals());
it('uses backend labels for known and unknown actions and sends filter and cursor', async () => {
  vi.stubGlobal('fetch', async (request: Request) => {
    const url = new URL(request.url);
    expect(url.pathname).toBe('/api/v1/audit-logs');
    expect(url.searchParams.get('kind')).toBe('user');
    expect(url.searchParams.get('after')).toBe('previous');
    return Response.json({
      items: [record, { ...record, id: 'b', action: 'future.action', action_label: '未知操作' }],
      next_cursor: 'b',
    });
  });
  const result = await listAuditLogs('user', 'previous');
  expect(result.nextCursor).toBe('b');
  expect(result.items[0]).toMatchObject({
    action: '提交节点任务',
    ip: '未记录',
    target: 'node / n',
  });
  expect(result.items[1].action).toBe('未知操作');
});
it.each([
  null,
  { items: [{ ...record, action_label: undefined }], next_cursor: '' },
  { items: [{ ...record, action_label: ' ' }], next_cursor: '' },
  {},
  { items: [], next_cursor: null },
  { items: [{ ...record, created_at: 'invalid' }], next_cursor: '' },
])('rejects malformed responses', async (body) => {
  vi.stubGlobal('fetch', async () => Response.json(body));
  await expect(listAuditLogs('all')).rejects.toMatchObject({ kind: 'invalid-response' });
});
it('distinguishes empty results from denied access', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ items: [], next_cursor: '' }));
  expect((await listAuditLogs('system')).items).toEqual([]);
  vi.stubGlobal('fetch', async () => Response.json({ code: 'forbidden' }, { status: 403 }));
  await expect(listAuditLogs('all')).rejects.toMatchObject({ status: 403 });
});

it('shows node deletion audit records after the node is removed', async () => {
  vi.stubGlobal('fetch', async () =>
    Response.json({
      items: [{ ...record, action: 'node.delete', action_label: '删除节点' }],
      next_cursor: '',
    }),
  );
  expect((await listAuditLogs('user')).items[0]).toMatchObject({
    action: '删除节点',
    target: 'node / n',
  });
});
