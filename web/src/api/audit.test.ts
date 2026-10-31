import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { listAuditLogs } from './audit';

const record = {
  id: 'a',
  kind: 'user',
  actor_id: 'u',
  actor: '管理员',
  action: 'task.create',
  resource_type: 'node',
  resource_id: 'n',
  source_ip: '',
  created_at: '2026-10-31T00:00:00Z',
};
beforeEach(() => vi.stubGlobal('location', { origin: 'http://localhost' }));
afterEach(() => vi.unstubAllGlobals());
it('maps real records, preserves unknown actions and sends filter and cursor', async () => {
  vi.stubGlobal('fetch', async (request: Request) => {
    const url = new URL(request.url);
    expect(url.pathname).toBe('/api/v1/audit-logs');
    expect(url.searchParams.get('kind')).toBe('user');
    expect(url.searchParams.get('after')).toBe('previous');
    return Response.json({
      items: [record, { ...record, id: 'b', action: 'future.action' }],
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
  expect(result.items[1].action).toBe('future.action');
});
it.each([
  null,
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
