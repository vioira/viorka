import { describe, expect, it } from 'vitest';
import type { EngineService } from '@/api/engines';
import type { ProtocolPreset } from '@/api/protocol-presets';
import { presetIssue } from './PresetPicker';
import { referenceService } from './PresetServiceEditor';

const preset: ProtocolPreset = {
  id: 'shared',
  created_at: '',
  referenceable: true,
  reference_issues: { 'sing-box': '', xray: '', realm: '仅支持转发' },
  config: {
    name: 'VLESS 443',
    protocol: 'vless',
    port: 443,
    transport: 'tcp',
    security: 'reality',
    site: 'external',
    target: '[2001:db8::1]:8443',
    server_name: 'example.com',
    short_ids: ['aabb'],
    fingerprint: 'chrome',
    certificate: '',
    cdn_host: '',
    path: '',
  },
};
const service: EngineService = {
  id: 'service',
  name: '',
  enabled: false,
  pending_delete: false,
  listen_host: '127.0.0.1',
  listen_port: 9443,
  target_host: '',
  target_port: 0,
  server_name: '',
  public_host: 'node.example.com',
  public_port: 10443,
};

describe('protocol reference', () => {
  it('inherits shared configuration while preserving node address, mapping and state', () => {
    expect(referenceService(service, preset)).toEqual({
      ...service,
      preset_id: 'shared',
      name: 'VLESS 443',
      listen_port: 443,
      target_host: '2001:db8::1',
      target_port: 8443,
      server_name: 'example.com',
    });
    expect(service.listen_port).toBe(9443);
  });
  it('uses per-engine server decisions and refuses unconfirmed capability', () => {
    expect(presetIssue(preset, 'sing-box')).toBe('');
    expect(presetIssue(preset, 'realm')).toBe('仅支持转发');
    expect(presetIssue(preset, 'unknown')).not.toBe('');
    expect(
      presetIssue(
        { ...preset, reference_issues: { xray: '尚未接入 XHTTP', 'sing-box': '不支持 XHTTP' } },
        'xray',
      ),
    ).toBe('尚未接入 XHTTP');
  });
});

it('switching a preset resets explicit overrides, including values equal to its defaults', () => {
  const overridden = { ...service, port_override: 443, sni_override: 'example.com' };
  const next = referenceService(overridden, preset);
  expect(next.port_override).toBeUndefined();
  expect(next.sni_override).toBeUndefined();
  expect(next.listen_port).toBe(preset.config.port);
  expect(next.server_name).toBe(preset.config.server_name);
  expect(overridden.port_override).toBe(443);
});
