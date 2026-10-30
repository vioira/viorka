import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from './client';

beforeEach(() => vi.stubGlobal('location', { origin: 'http://localhost' }));
afterEach(() => vi.unstubAllGlobals());

function mockResponse(body: string | null, init: ResponseInit = {}) {
  const requests: Request[] = [];
  const fetcher = vi.fn().mockImplementation(async (request: Request) => {
    requests.push(request.clone());
    return new Response(body, init);
  });
  vi.stubGlobal('fetch', fetcher);
  return Object.assign(fetcher, { requests });
}

describe('apiRequest', () => {
  it('encodes query values, includes cookies, and decodes JSON', async () => {
    const fetcher = mockResponse('{"items":[]}');
    await expect(
      apiRequest('/nodes', {
        query: { name: 'a&b 空格', page: 2, online: false, skip: undefined },
      }),
    ).resolves.toEqual({ items: [] });
    const request = fetcher.requests[0];
    const url = new URL(request.url);
    expect(url.pathname).toBe('/api/v1/nodes');
    expect([...url.searchParams]).toEqual([
      ['name', 'a&b 空格'],
      ['page', '2'],
      ['online', 'false'],
    ]);
    expect(request.credentials).toBe('same-origin');
    expect(request.redirect).toBe('error');
  });

  it('sends JSON, caller headers, and explicit CSRF', async () => {
    const fetcher = mockResponse('{"id":"task-1"}', { status: 202 });
    await expect(
      apiRequest('/tasks', {
        method: 'POST',
        json: { type: 'node.inspect' },
        csrfToken: 'csrf',
        headers: new Headers({ 'X-Test': 'yes' }),
      }),
    ).resolves.toEqual({ id: 'task-1' });
    const request = fetcher.requests[0];
    expect(request.headers.get('Content-Type')).toBe('application/json');
    expect(request.headers.get('X-CSRF-Token')).toBe('csrf');
    expect(request.headers.get('X-Test')).toBe('yes');
    expect(await request.json()).toEqual({ type: 'node.inspect' });
  });

  it('accepts 204 only when the caller expects no data', async () => {
    mockResponse(null, { status: 204 });
    await expect(
      apiRequest('/auth/logout', { method: 'POST', responseType: 'void' }),
    ).resolves.toBeUndefined();
    await expect(apiRequest('/nodes')).rejects.toMatchObject({ kind: 'invalid-response' });
  });

  it('preserves structured errors and diagnostic headers without retrying', async () => {
    const fetcher = mockResponse('{"code":"rate_limited","message":"稍后重试"}', {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'X-Request-ID': 'req-1', 'Retry-After': '60' },
    });
    await expect(apiRequest('/tasks', { method: 'POST' })).rejects.toMatchObject({
      kind: 'http',
      status: 429,
      code: 'rate_limited',
      message: '稍后重试',
      requestId: 'req-1',
      retryAfter: '60',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not expose non-JSON proxy error bodies or retry GET requests', async () => {
    const fetcher = mockResponse('<html>internal proxy details</html>', { status: 503 });
    await expect(apiRequest('/nodes')).rejects.toMatchObject({
      kind: 'http',
      status: 503,
      message: '服务暂时不可用，请稍后重试。',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed success JSON', async () => {
    mockResponse('<html>SPA fallback</html>');
    await expect(apiRequest('/nodes')).rejects.toMatchObject({ kind: 'invalid-response' });
  });

  it('reports network failures without retaining the credential-bearing request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const error = await apiRequest('/auth/login', {
      method: 'POST',
      json: { password: 'secret' },
    }).catch((e) => e);
    expect(error).toMatchObject({ kind: 'network' });
    expect(error).not.toHaveProperty('request');
    expect(error).not.toHaveProperty('cause');
  });

  it('distinguishes timeout from cancellation and bounds stalled bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise(() => {})),
    );
    await expect(apiRequest('/nodes', { timeoutMs: 20 })).rejects.toMatchObject({
      kind: 'timeout',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('{'));
              },
            }),
          ),
      ),
    );
    await expect(apiRequest('/nodes', { timeoutMs: 20 })).rejects.toMatchObject({
      kind: 'timeout',
    });
  });

  it('preserves caller cancellation reasons', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (request: Request) =>
          new Promise((_, reject) => {
            if (request.signal.aborted) {
              reject(request.signal.reason);
              return;
            }
            request.signal.addEventListener('abort', () => reject(request.signal.reason), {
              once: true,
            });
          }),
      ),
    );
    const controller = new AbortController();
    const reason = new DOMException('Route changed', 'AbortError');
    const result = apiRequest('/nodes', { signal: controller.signal });
    controller.abort(reason);
    await expect(result).rejects.toBe(reason);
  });

  it.each(['https://example.com', '//example.com', '/../other', '/nodes?token=secret'])(
    'rejects non-API paths: %s',
    async (path) => {
      const fetcher = mockResponse('{}');
      await expect(apiRequest(path)).rejects.toBeInstanceOf(TypeError);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
});
