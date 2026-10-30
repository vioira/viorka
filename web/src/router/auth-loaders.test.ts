import { createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loginLoader, requireSession } from './auth-loaders';

const session = {
  user: { id: 'test-user', username: 'operator', role: 'operator' as const },
  csrf_token: 'test-csrf',
  expires_at: '2030-01-01T00:00:00Z',
};

beforeEach(() => vi.stubGlobal('location', { origin: 'http://localhost' }));
afterEach(() => vi.unstubAllGlobals());

function respond(status: number, body: unknown = {}) {
  const requests: Request[] = [];
  const fetcher = vi.fn().mockImplementation(async (request: Request) => {
    requests.push(request.clone());
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetcher);
  return Object.assign(fetcher, { requests });
}

describe('session routes', () => {
  it('redirects an unauthenticated protected request to login', async () => {
    respond(401);
    const router = createMemoryRouter(
      [
        { path: '/', loader: requireSession },
        { path: '/login', loader: loginLoader },
      ],
      { initialEntries: ['/'] },
    );
    try {
      await vi.waitFor(() => expect(router.state.location.pathname).toBe('/login'));
      expect(router.state.errors).toBeNull();
    } finally {
      router.dispose();
    }
  });

  it('restores a cookie session after a direct page load', async () => {
    const fetcher = respond(200, session);
    const router = createMemoryRouter([{ path: '/', loader: requireSession }]);
    try {
      await vi.waitFor(() => expect(router.state.initialized).toBe(true));
      expect(Object.values(router.state.loaderData)).toContainEqual(session);
      const request = fetcher.requests[0];
      expect(request.url).toBe('http://localhost/api/v1/auth/session');
      expect(request.credentials).toBe('same-origin');
      expect(request.signal).toBeInstanceOf(AbortSignal);
    } finally {
      router.dispose();
    }
  });

  it('redirects an authenticated login visit to the protected page', async () => {
    respond(200, session);
    const router = createMemoryRouter(
      [
        { path: '/', loader: requireSession },
        { path: '/login', loader: loginLoader },
      ],
      { initialEntries: ['/login'] },
    );
    try {
      await vi.waitFor(() => expect(router.state.location.pathname).toBe('/'));
    } finally {
      router.dispose();
    }
  });

  it('keeps service failures as route errors instead of redirecting to login', async () => {
    respond(503);
    const router = createMemoryRouter([{ path: '/', loader: requireSession }]);
    try {
      await vi.waitFor(() => expect(router.state.errors).not.toBeNull());
      expect(router.state.location.pathname).toBe('/');
    } finally {
      router.dispose();
    }
  });
});
