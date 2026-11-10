import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Session } from './auth';
import type { TelemetrySettings } from './telemetry';
import {
  getTelemetrySettings,
  getTelemetrySettingsStatus,
  parseTelemetrySettingsStatus,
  saveTelemetrySettings,
  telemetrySettingsState,
} from './telemetry-settings';

const settings: TelemetrySettings = {
  revision: 3,
  log_level: 'debug',
  collection_seconds: 60,
  http_report_seconds: 30,
  wss_report_seconds: 1,
  connection_mode: 'auto_http_wss',
};
const session: Session = {
  user: { id: 'u', username: 'a', role: 'admin' },
  csrf_token: 'csrf',
  expires_at: '',
};
beforeEach(() => vi.stubGlobal('location', { origin: 'http://localhost' }));
afterEach(() => vi.unstubAllGlobals());
it('reads and saves the independent v3 configuration with CSRF and optimistic revision', async () => {
  const requests: Request[] = [];
  vi.stubGlobal('fetch', async (r: Request) => {
    requests.push(r.clone());
    return Response.json({
      ...settings,
      revision: r.method === 'PUT' ? 4 : 3,
      ...(r.method === 'GET' ? { status: { state: 'pending' } } : {}),
    });
  });
  expect(await getTelemetrySettings('node-1')).toEqual({
    desired: settings,
    status: { state: 'pending' },
  });
  expect((await saveTelemetrySettings(session, 'node-1', settings)).revision).toBe(4);
  expect(requests.map((r) => new URL(r.url).pathname)).toEqual([
    '/api/v1/nodes/node-1/telemetry-settings',
    '/api/v1/nodes/node-1/telemetry-settings',
  ]);
  expect(requests[1].headers.get('X-CSRF-Token')).toBe('csrf');
  expect(await requests[1].json()).toEqual(settings);
});
it.each([
  { ...settings, collection_seconds: 0 },
  { ...settings, collection_seconds: 61 },
  { ...settings, http_report_seconds: 29 },
  { ...settings, http_report_seconds: 181 },
  { ...settings, wss_report_seconds: 0 },
  { ...settings, wss_report_seconds: 6 },
  { ...settings, collection_seconds: 1.5 },
  { ...settings, revision: Number.MAX_SAFE_INTEGER + 1 },
])('rejects invalid outgoing values without making a request: %o', async (value) => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await expect(saveTelemetrySettings(session, 'n', value)).rejects.toMatchObject({
    kind: 'invalid-response',
  });
  expect(fetch).not.toHaveBeenCalled();
});
it('keeps a settings conflict as an error and does not retry writes', async () => {
  const fetch = vi.fn(async () =>
    Response.json({ error: { code: 'conflict', message: '配置版本已变化' } }, { status: 409 }),
  );
  vi.stubGlobal('fetch', fetch);
  await expect(saveTelemetrySettings(session, 'n', settings)).rejects.toMatchObject({
    status: 409,
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('reads pending, successful and failed Agent confirmation independently', async () => {
  for (const status of [
    { state: 'pending' },
    { state: 'applied', result: { revision: 3, applied_revision: 3, state: 'applied' } },
    {
      state: 'failed',
      result: { revision: 3, applied_revision: 2, state: 'failed', error_code: 'persist_failed' },
    },
  ]) {
    vi.stubGlobal('fetch', async (r: Request) => {
      expect(new URL(r.url).pathname).toBe('/api/v1/nodes/n/telemetry-settings/status');
      return Response.json(status);
    });
    expect(await getTelemetrySettingsStatus('n')).toEqual(status);
  }
});
it.each([
  null,
  { state: 'applied' },
  { state: 'pending', result: {} },
  { state: 'applied', result: { revision: 3, applied_revision: 2, state: 'applied' } },
  {
    state: 'applied',
    result: { revision: 3, applied_revision: 3, state: 'applied', error_code: 'persist_failed' },
  },
  {
    state: 'failed',
    result: { revision: 3, applied_revision: 2, state: 'failed', error_code: 'bogus' },
  },
])('rejects inconsistent confirmation: %o', (value) => {
  expect(() => parseTelemetrySettingsStatus(value)).toThrow('确认状态无效');
});
it('does not label a newer desired revision applied based on an older acknowledgment', () => {
  const old = parseTelemetrySettingsStatus({
    state: 'applied',
    result: { revision: 2, applied_revision: 2, state: 'applied' },
  });
  expect(telemetrySettingsState(settings, old)).toBe('pending');
  expect(telemetrySettingsState(settings, undefined)).toBe('unknown');
  expect(telemetrySettingsState({ ...settings, revision: 2 }, old)).toBe('applied');
});

it.each(['trace', 'WARN', '', null, 1])('rejects invalid log level %s', async (log_level) => {
  vi.stubGlobal('fetch', async () => Response.json({ ...settings, log_level }));
  await expect(getTelemetrySettings('node-1')).rejects.toMatchObject({ kind: 'invalid-response' });
});
