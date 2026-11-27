import { expect, it } from 'vitest';
import { newOutbound, type Outbound } from '@/api/outbounds';
import { type OutboundDraft, validateOutboundDraft } from './outbound-validation';

const base: OutboundDraft = {
  ...newOutbound(),
  server_port: '443',
  name: '测试',
  server: 'example.org',
  uuid: '12345678-1234-4234-8234-123456789012',
  server_name: 'example.org',
  public_key: 'A'.repeat(43),
};

it.each([
  '188.239.1',
  '999.1.2.3',
  '1.01.2.3',
  '127.1',
  '0x7f.1',
  '0.0.0.0',
  '224.1.2.3',
  'ff02::1',
  '::ffff:e000:1',
  '::',
  '[::1]',
  '1::2::3',
  'fe80::1%eth0',
  'https://example.org',
  'host:443',
  '-bad.example',
  'host\nname',
])('rejects invalid server %s', (server) => {
  expect(validateOutboundDraft({ ...base, server }, null)?.field).toBe('server');
});
it.each([
  '188.239.1.2',
  '::1',
  'ff::1',
  '2001:db8::1',
  '::ffff:192.0.2.1',
  'localhost',
  '123.example.org',
  'xn--bcher-kva.example',
])('accepts valid server %s', (server) => {
  expect(validateOutboundDraft({ ...base, server }, null)).toBeUndefined();
});
it.each<[Partial<OutboundDraft>, string]>([
  [{ name: '' }, 'name'],
  [{ name: ' test' }, 'name'],
  [{ name: '出'.repeat(43) }, 'name'],
  ...['', '0', '65536', '12.5', '443x', '123456'].map(
    (server_port): [Partial<OutboundDraft>, string] => [{ server_port }, 'server_port'],
  ),
  [{ uuid: '12345678-1234-4234-8234-1234567890--' }, 'uuid'],
  [{ public_key: 'A'.repeat(42) }, 'public_key'],
  [{ public_key: '+'.repeat(43) }, 'public_key'],
  [{ short_id: 'abc' }, 'short_id'],
  [{ short_id: 'xx' }, 'short_id'],
  [{ server_name: '188.239.1' }, 'server_name'],
  [{ type: 'http', server_name: 'host:443' }, 'server_name'],
  [{ type: 'socks', password: 'secret' }, 'username'],
  [{ type: 'http', username: 'operator' }, 'password'],
  [{ type: 'socks', username: '甲'.repeat(86) }, 'username'],
  [{ type: 'socks', password: '字'.repeat(342) }, 'password'],
])('identifies the invalid field %#', (changes, field) => {
  expect(validateOutboundDraft({ ...base, ...changes }, null)?.field).toBe(field);
});
it('reuses redacted credentials only for the saved protocol', () => {
  const saved: Outbound = {
    id: 'test',
    version: 2,
    config: newOutbound(),
    has_uuid: true,
    has_password: false,
    references: 0,
  };
  expect(validateOutboundDraft({ ...base, uuid: '' }, saved)).toBeUndefined();
  expect(validateOutboundDraft({ ...base, uuid: '' }, null)?.field).toBe('uuid');
  const socks = {
    ...saved,
    config: { ...saved.config, type: 'socks' as const },
    has_uuid: false,
    has_password: true,
  };
  const draft = { ...base, type: 'socks' as const, username: 'user', password: '' };
  expect(validateOutboundDraft(draft, socks)).toBeUndefined();
  expect(validateOutboundDraft({ ...draft, type: 'http' }, socks)?.field).toBe('password');
  expect(validateOutboundDraft({ ...draft, username: '' }, socks)).toBeUndefined();
});

it('keeps a saved SS credential only for the same method and validates a replacement PSK', () => {
  const draft: OutboundDraft = {
    type: 'shadowsocks',
    method: 'aes-128-gcm',
    name: 'SS',
    id: 'ss',
    server: 'localhost',
    server_port: '8388',
  };
  const stored: Outbound = {
    id: 'ss',
    version: 1,
    config: { ...draft, server_port: 8388 },
    has_password: true,
    has_uuid: false,
    references: 0,
  };
  expect(validateOutboundDraft(draft, stored)).toBeUndefined();
  expect(validateOutboundDraft(draft, null)?.field).toBe('password');
  const next = { ...draft, method: '2022-blake3-aes-128-gcm' };
  expect(validateOutboundDraft(next, stored)?.field).toBe('password');
  expect(validateOutboundDraft({ ...next, password: 'invalid' }, stored)?.field).toBe('password');
  expect(
    validateOutboundDraft({ ...next, password: btoa('a'.repeat(16)) }, stored),
  ).toBeUndefined();
});
