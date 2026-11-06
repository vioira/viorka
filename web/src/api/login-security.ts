import type { Session } from './auth';
import { apiRequest } from './client';

export interface Passkey {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string;
}
export interface SessionIP {
  ip: string;
  first_used_at: string;
  last_used_at: string;
  location?: string;
}
export interface SessionRecord {
  id: string;
  user_id: string;
  username: string;
  method: string;
  source: string;
  user_agent: string;
  first_ip: string;
  latest_ip: string;
  created_at: string;
  last_active_at: string;
  expires_at: string;
  ended_at: string;
  end_reason: string;
  first_location: string;
  latest_location: string;
  current: boolean;
  ips: SessionIP[];
}
export interface SessionHistory {
  items: SessionRecord[];
  next_cursor: string;
}
export const listPasskeys = (signal?: AbortSignal) =>
  apiRequest<{ items: Passkey[] }>('/auth/passkeys', { signal });
export const listSessions = (after = '', signal?: AbortSignal) =>
  apiRequest<SessionHistory>('/auth/sessions', { query: { after, limit: 20 }, signal });
export const revokeSession = (s: Session, id: string) =>
  apiRequest(`/auth/sessions/${id}`, {
    method: 'DELETE',
    csrfToken: s.csrf_token,
    responseType: 'void',
  });
export const removePasskey = (s: Session, id: string) =>
  apiRequest(`/auth/passkeys/${id}`, {
    method: 'DELETE',
    csrfToken: s.csrf_token,
    responseType: 'void',
  });

function buffer(value: string): ArrayBuffer {
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0)).buffer;
}
function encoded(value: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(value)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
interface Descriptor extends Omit<PublicKeyCredentialDescriptor, 'id'> {
  id: string;
}
interface Creation
  extends Omit<PublicKeyCredentialCreationOptions, 'challenge' | 'user' | 'excludeCredentials'> {
  challenge: string;
  user: Omit<PublicKeyCredentialUserEntity, 'id'> & { id: string };
  excludeCredentials?: Descriptor[];
}
interface Assertion
  extends Omit<PublicKeyCredentialRequestOptions, 'challenge' | 'allowCredentials'> {
  challenge: string;
  allowCredentials?: Descriptor[];
}
function requireWebAuthn() {
  if (!window.isSecureContext || !window.PublicKeyCredential)
    throw new Error('此浏览器或地址不支持通行密钥，请使用 HTTPS 和支持 WebAuthn 的浏览器。');
}
function serialize(key: PublicKeyCredential) {
  const response = key.response;
  const common = {
    id: key.id,
    rawId: encoded(key.rawId),
    type: key.type,
    clientExtensionResults: key.getClientExtensionResults(),
    authenticatorAttachment: key.authenticatorAttachment,
  };
  if (response instanceof AuthenticatorAttestationResponse)
    return {
      ...common,
      response: {
        clientDataJSON: encoded(response.clientDataJSON),
        attestationObject: encoded(response.attestationObject),
        transports: response.getTransports(),
      },
    };
  const assertion = response as AuthenticatorAssertionResponse;
  return {
    ...common,
    response: {
      clientDataJSON: encoded(response.clientDataJSON),
      authenticatorData: encoded(assertion.authenticatorData),
      signature: encoded(assertion.signature),
      userHandle: assertion.userHandle ? encoded(assertion.userHandle) : null,
    },
  };
}
export async function registerPasskey(s: Session, password: string, name: string) {
  requireWebAuthn();
  const { publicKey: options } = await apiRequest<{ publicKey: Creation }>(
    '/auth/passkeys/register/begin',
    { method: 'POST', csrfToken: s.csrf_token, json: { password, username: '' } },
  );
  const key = await navigator.credentials.create({
    publicKey: {
      ...options,
      challenge: buffer(options.challenge),
      user: { ...options.user, id: buffer(options.user.id) },
      excludeCredentials: options.excludeCredentials?.map((c) => ({ ...c, id: buffer(c.id) })),
    },
  });
  if (!(key instanceof PublicKeyCredential)) throw new Error('未创建通行密钥，请重试。');
  await apiRequest('/auth/passkeys/register/finish', {
    method: 'POST',
    csrfToken: s.csrf_token,
    json: { name, credential: serialize(key) },
    responseType: 'void',
  });
}
export async function loginWithPasskey(username: string) {
  requireWebAuthn();
  if (!username.trim()) throw new Error('请先输入用户名，再使用通行密钥登录。');
  const { publicKey: options } = await apiRequest<{ publicKey: Assertion }>(
    '/auth/passkeys/login/begin',
    { method: 'POST', json: { username, password: '' } },
  );
  const key = await navigator.credentials.get({
    publicKey: {
      ...options,
      challenge: buffer(options.challenge),
      allowCredentials: options.allowCredentials?.map((c) => ({ ...c, id: buffer(c.id) })),
    },
  });
  if (!(key instanceof PublicKeyCredential)) throw new Error('未完成通行密钥验证，请重试。');
  return apiRequest<Session>('/auth/passkeys/login/finish', {
    method: 'POST',
    json: { name: '', credential: serialize(key) },
  });
}
export function passkeyError(error: unknown) {
  if (error instanceof DOMException && error.name === 'NotAllowedError')
    return '通行密钥验证已取消或超时，可以重试或使用密码登录。';
  return error instanceof Error ? error.message : '操作未完成，请重试。';
}
