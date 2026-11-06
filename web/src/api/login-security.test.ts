import { afterEach, expect, it, vi } from 'vitest';
import { apiRequest } from './client';
import { loginWithPasskey, passkeyError } from './login-security';

const requestMock = vi.hoisted(() => vi.fn());
vi.mock('./client', () => ({ apiRequest: requestMock }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
it('converts WebAuthn base64url options and serializes the signed assertion', async () => {
  class Credential {
    id = 'key';
    rawId = new Uint8Array([255, 0, 128]).buffer;
    type = 'public-key';
    authenticatorAttachment = 'platform';
    response = {
      clientDataJSON: new Uint8Array([1, 2]).buffer,
      authenticatorData: new Uint8Array([3, 4]).buffer,
      signature: new Uint8Array([251, 255]).buffer,
      userHandle: null,
    };
    getClientExtensionResults() {
      return {};
    }
  }
  vi.stubGlobal('window', { isSecureContext: true, PublicKeyCredential: Credential });
  vi.stubGlobal('PublicKeyCredential', Credential);
  vi.stubGlobal('AuthenticatorAttestationResponse', class {});
  const get = vi.fn().mockResolvedValue(new Credential());
  vi.stubGlobal('navigator', { credentials: { get } });
  requestMock
    .mockResolvedValueOnce({
      publicKey: {
        challenge: '-_8',
        rpId: 'example.com',
        userVerification: 'required',
        allowCredentials: [{ id: '_wCA', type: 'public-key' }],
      },
    })
    .mockResolvedValueOnce({ user: { id: 'owner' } });
  await expect(loginWithPasskey('owner')).resolves.toEqual({ user: { id: 'owner' } });
  const options = get.mock.calls[0][0].publicKey;
  expect([...new Uint8Array(options.challenge)]).toEqual([251, 255]);
  expect([...new Uint8Array(options.allowCredentials[0].id)]).toEqual([255, 0, 128]);
  expect(options.userVerification).toBe('required');
  expect(apiRequest).toHaveBeenLastCalledWith(
    '/auth/passkeys/login/finish',
    expect.objectContaining({
      json: {
        name: '',
        credential: {
          id: 'key',
          rawId: '_wCA',
          type: 'public-key',
          authenticatorAttachment: 'platform',
          clientExtensionResults: {},
          response: {
            clientDataJSON: 'AQI',
            authenticatorData: 'AwQ',
            signature: '-_8',
            userHandle: null,
          },
        },
      },
    }),
  );
});
it('rejects insecure contexts without starting a challenge', async () => {
  vi.stubGlobal('window', { isSecureContext: false });
  await expect(loginWithPasskey('owner')).rejects.toThrow('HTTPS');
  expect(apiRequest).not.toHaveBeenCalled();
});
it('explains authenticator cancellation without reporting success', () => {
  expect(passkeyError(new DOMException('cancelled', 'NotAllowedError'))).toContain('取消或超时');
});
