import ky, { isHTTPError, isNetworkError, isTimeoutError } from 'ky';

export type ApiErrorKind = 'http' | 'network' | 'timeout' | 'invalid-response';

/** Contains safe API metadata only; never retains the Request or credentials. */
export class ApiError extends Error {
  readonly name = 'ApiError';

  constructor(
    message: string,
    public readonly kind: ApiErrorKind,
    public readonly status?: number,
    public readonly code?: string,
    public readonly requestId?: string,
    public readonly retryAfter?: string,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  json?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: HeadersInit;
  csrfToken?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const client = ky.create({
  credentials: 'same-origin',
  retry: 0,
  redirect: 'error',
  timeout: 12000,
  totalTimeout: 12000,
});

const statusMessages: Record<number, string> = {
  400: '请求参数无效，请检查后重试。',
  401: '会话无效或已过期，请重新登录。',
  403: '请求未获授权，请联系管理员。',
  404: '请求的资源不存在，请刷新页面。',
  409: '资源状态已变化，请刷新后重试。',
  429: '请求过于频繁，请稍后重试。',
};

export function apiRequest<T>(
  path: string,
  options?: RequestOptions & { responseType?: 'json' },
): Promise<T>;
export function apiRequest(
  path: string,
  options: RequestOptions & { responseType: 'void' },
): Promise<void>;
export async function apiRequest<T>(
  path: string,
  options: RequestOptions & { responseType?: 'json' | 'void' } = {},
): Promise<T | undefined> {
  // Only canonical API-relative paths. Query values belong in `query`.
  if (!/^\/(?:[A-Za-z0-9_-]+\/?)+$/.test(path)) {
    throw new TypeError('API path must be a canonical path such as /auth/session');
  }
  const {
    json,
    query,
    csrfToken,
    signal,
    timeoutMs = 12000,
    responseType,
    method = 'GET',
  } = options;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new TypeError('timeoutMs must be positive');
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (csrfToken) headers.set('X-CSRF-Token', csrfToken);
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) searchParams.set(key, String(value));
  }

  try {
    const response = client(new URL(`/api/v1${path}`, location.origin), {
      method,
      json,
      searchParams,
      headers,
      signal,
      timeout: timeoutMs,
      totalTimeout: timeoutMs,
      // Resolve Fetch at call time, including in tests.
      fetch: (request, init) => globalThis.fetch(request, init),
    });
    if (responseType === 'void') {
      await response;
      return;
    }
    return await response.json<T>();
  } catch (error) {
    // A cancelled route is not a network failure. Preserve the caller's reason.
    if (signal?.aborted) throw signal.reason;
    if (isHTTPError(error)) {
      const body = error.data;
      const payload =
        typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
      throw new ApiError(
        typeof payload.message === 'string' && payload.message
          ? payload.message
          : (statusMessages[error.response.status] ?? '服务暂时不可用，请稍后重试。'),
        'http',
        error.response.status,
        typeof payload.code === 'string' ? payload.code : undefined,
        error.response.headers.get('X-Request-ID') ?? undefined,
        error.response.headers.get('Retry-After') ?? undefined,
      );
    }
    if (isTimeoutError(error)) throw new ApiError('请求超时，请稍后重试。', 'timeout');
    if (isNetworkError(error)) throw new ApiError('无法连接服务器，请检查网络后重试。', 'network');
    if (error instanceof SyntaxError)
      throw new ApiError('服务器响应格式无效，请联系管理员。', 'invalid-response');
    throw error;
  }
}
