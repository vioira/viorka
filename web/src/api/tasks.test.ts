import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getTask, getTaskSummary, listTasks } from './tasks';

const task = {
  id: 'task-1',
  node_id: 'node-1',
  node_name: 'Hong Kong',
  operation: 'node.inspect',
  idempotency_key: 'key-1',
  state: 'queued',
  attempt: 0,
  max_attempts: 3,
  created_at: '2026-10-31T00:00:00Z',
  updated_at: '2026-10-31T00:00:00Z',
  deadline_at: '2026-10-31T00:05:00Z',
  result: null,
  error_code: '',
};
const summary = {
  since: '2026-10-30T00:00:00Z',
  until: '2026-10-31T00:00:00Z',
  total: 4,
  succeeded: 2,
  failed: 1,
  active: 1,
  success_rate: 200 / 3,
};
beforeEach(() => vi.stubGlobal('location', { origin: 'http://localhost' }));
afterEach(() => vi.unstubAllGlobals());
it('requests the server filter and exclusive cursor without aggregating node pages', async () => {
  let url: URL | undefined;
  vi.stubGlobal('fetch', async (request: Request) => {
    url = new URL(request.url);
    return Response.json({ items: [task], next_cursor: task.id });
  });
  expect((await listTasks('queued', 'previous')).items).toEqual([task]);
  expect(url?.pathname).toBe('/api/v1/tasks');
  expect(Object.fromEntries(url?.searchParams ?? [])).toEqual({
    state: 'queued',
    after: 'previous',
    limit: '50',
  });
});
it('rejects a detail response for a different task', async () => {
  vi.stubGlobal('fetch', async () => Response.json(task));
  expect(await getTask(task.id)).toEqual(task);
  await expect(getTask('other')).rejects.toMatchObject({ kind: 'invalid-response' });
});
it.each([
  null,
  {},
  { items: [null], next_cursor: '' },
  { items: [{ ...task, created_at: 'bad' }], next_cursor: '' },
  { items: [task, task], next_cursor: '' },
  { items: [task], next_cursor: 'wrong' },
])('rejects malformed task pages', async (value) => {
  vi.stubGlobal('fetch', async () => Response.json(value));
  await expect(listTasks()).rejects.toMatchObject({ kind: 'invalid-response' });
});
it('preserves a missing success rate instead of claiming zero percent', async () => {
  vi.stubGlobal('fetch', async () =>
    Response.json({ ...summary, total: 0, succeeded: 0, failed: 0, active: 0, success_rate: null }),
  );
  expect((await getTaskSummary()).success_rate).toBeNull();
  vi.stubGlobal('fetch', async () => Response.json(summary));
  expect((await getTaskSummary()).success_rate).toBe(summary.success_rate);
});
it.each([
  { ...summary, success_rate: 101 },
  { ...summary, failed: -1 },
  { ...summary, total: 1 },
  { ...summary, since: 'bad' },
  { ...summary, success_rate: null },
])('rejects malformed summary', async (value) => {
  vi.stubGlobal('fetch', async () => Response.json(value));
  await expect(getTaskSummary()).rejects.toMatchObject({ kind: 'invalid-response' });
});
it('preserves cancellation and reports authorization failures', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(listTasks('all', '', controller.signal)).rejects.toBe(controller.signal.reason);
  vi.stubGlobal('fetch', async () => Response.json({ code: 'unauthorized' }, { status: 401 }));
  await expect(listTasks()).rejects.toMatchObject({ status: 401 });
});
