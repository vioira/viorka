import { expect, it } from 'vitest';
import type { PresetConfig } from '@/api/protocol-presets';
import {
  type PresetDraft,
  presetConfig,
  presetDraft,
  validatePresetDraft,
} from './preset-validation';

const config: PresetConfig = {
  name: 'Test',
  protocol: 'vless',
  port: 443,
  transport: 'tcp',
  security: 'reality',
  site: 'external',
  target: 'example.org:443',
  server_name: 'example.org',
  short_ids: [],
  fingerprint: 'chrome',
  path: '',
  cdn_host: '',
  certificate: '',
};
const base = presetDraft(config);
const tls: PresetDraft = {
  ...base,
  security: 'tls',
  transport: 'ws',
  site: '',
  target: '',
  certificate: 'letsencrypt',
  path: '/ws',
};

it.each([
  '188.239.1:443',
  '192.0.2.256:443',
  '0x7f.1:443',
  'example.org:65536',
  'example.org:+12',
  '[example.org]:443',
  '::1:443',
  'example.org',
  'https://example.org:443',
  'example.org:0',
  'example.org:443/path',
])('rejects invalid handshake target %s', (target) => {
  expect(validatePresetDraft({ ...base, target, server_name: 'example.org' }, [])?.field).toBe(
    'target',
  );
});
it.each(['192.0.2.3:80', '[2001:db8::1]:443'])('requires a separate SNI for %s', (target) => {
  expect(validatePresetDraft({ ...base, target }, [])?.field).toBe('server_name');
  expect(validatePresetDraft({ ...base, target, server_name: 'example.org' }, [])).toBeUndefined();
});
it('derives SNI from a valid domain target and preserves an independent stored SNI', () => {
  expect(presetConfig({ ...base, target: 'new.example:443' }, []).server_name).toBe('new.example');
  const independent = { ...config, server_name: 'sni.example' };
  expect(presetConfig(presetDraft(independent), [])).toEqual(independent);
});
it.each<[Partial<PresetDraft>, string]>([
  [{ name: '出'.repeat(43) }, 'name'],
  [{ name: 'test\u0001' }, 'name'],
  [{ port: '655350' }, 'port'],
  [{ port: '4e3' }, 'port'],
  [{ port: '0' }, 'port'],
  [{ server_name: '188.239.1' }, 'server_name'],
  [{ server_name: '[::1]' }, 'server_name'],
  [{ cdn_host: '192.0.2.1' }, 'cdn_host'],
  [{ certificate: 'self_signed' }, 'cdn_host'],
  [{ path: 'ws' }, 'path'],
  [{ path: '/ws?x' }, 'path'],
  [{ path: '/ws#x' }, 'path'],
  [{ path: '/a b' }, 'path'],
  [{ path: `/${'字'.repeat(86)}` }, 'path'],
])('identifies invalid field %#', (changes, field) => {
  expect(validatePresetDraft({ ...tls, ...changes }, [])?.field).toBe(field);
});
it('accepts saved-only combinations and optional TLS hostnames', () => {
  expect(validatePresetDraft(tls, [])).toBeUndefined();
  expect(
    validatePresetDraft({ ...tls, certificate: 'self_signed', cdn_host: 'cdn.example' }, []),
  ).toBeUndefined();
  expect(validatePresetDraft({ ...base, transport: 'xhttp', path: '/path' }, [])).toBeUndefined();
});
it('finds the offending Short ID and preserves empty-list semantics', () => {
  const ids = (values: string[]) => values.map((value, id) => ({ value, id }));
  expect(validatePresetDraft(base, ids(['', 'AB', 'ab']))?.field).toBe('short-id-2');
  expect(validatePresetDraft(base, ids(['abc']))?.field).toBe('short-id-0');
  expect(validatePresetDraft(base, ids(['ab'.repeat(9)]))?.field).toBe('short-id-0');
  expect(
    validatePresetDraft(base, ids(['00', '01', '02', '03', '04', '05', '06', '07', '08']))?.field,
  ).toBe('short-id-8');
  expect(presetConfig(base, ids([' ', ' AB '])).short_ids).toEqual(['ab']);
  expect(presetConfig(base, ids([' '])).short_ids).toEqual([]);
});
