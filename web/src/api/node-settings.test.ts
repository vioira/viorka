import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getNodeSettings, saveNodeSettings } from './node-settings';

const settings = {
  revision: 1,
  collection_seconds: 10,
  report_seconds: 60,
  connection_mode: 'wss' as const,
  wss_report_seconds: 2,
};
beforeEach(() => vi.stubGlobal('location', { origin: 'http://localhost' }));
afterEach(() => vi.unstubAllGlobals());
it('loads per-node settings and saves seconds with CSRF and revision', async () => {
  let request: Request | undefined;
  vi.stubGlobal('fetch', async (r: Request) => {
    request = r.clone();
    return Response.json(settings);
  });
  expect(await getNodeSettings('node-1')).toEqual(settings);
  if (!request) throw new Error('request missing');
  expect(new URL(request.url).pathname).toBe('/api/v1/nodes/node-1/settings');
  await saveNodeSettings(
    { user: { id: 'u', username: 'a', role: 'admin' }, csrf_token: 'csrf', expires_at: '' },
    'node-1',
    settings,
  );
  expect(request?.method).toBe('PUT');
  expect(request?.headers.get('X-CSRF-Token')).toBe('csrf');
  expect(await request?.json()).toEqual(settings);
});
it.each([
  null,
  { ...settings, connection_mode: 'http_post' },
  { ...settings, collection_seconds: 11 },
  { ...settings, report_seconds: 29 },
  { ...settings, wss_report_seconds: 6 },
])('rejects unsupported or malformed settings', async (value) => {
  vi.stubGlobal('fetch', async () => Response.json(value));
  await expect(getNodeSettings('n')).rejects.toMatchObject({ kind: 'invalid-response' });
});
