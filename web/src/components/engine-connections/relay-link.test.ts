import { describe, expect, it } from 'vitest';
import type { RelayPath, RelayRoute } from '@/api/relays';
import {
  buildRelayConnectionUrl,
  classifyRelayOptions,
  extractConnectionEndpoint,
  relayFragmentName,
} from './relay-link';

const directV4 =
  'vless://12345678-1234-4234-8234-123456789012@198.51.100.20:443?encryption=none&flow=xtls-rprx-vision&fp=chrome&pbk=PUBKEY123&security=reality&sid=aabb&sni=example.com&type=tcp#jp-vless';
const directV6 =
  'vless://12345678-1234-4234-8234-123456789012@[2001:db8::20]:443?encryption=none&security=reality&type=tcp#jp-v6';

const samplePath: RelayPath = {
  name: '日本专线',
  engine_id: 'realm-hk',
  landing_engine_id: 'sb-jp',
  landing_service_id: 'svc-1',
  version: 2,
  landing_revision: 3,
  public: { host: '203.0.113.10', port: 30001 },
  listen: { host: '0.0.0.0', port: 10080 },
  dial: { host: '198.51.100.20', port: 443 },
  landing_listen: { host: '::', port: 443 },
  landing_name: 'jp-vless',
};

const baseRoute: RelayRoute = {
  id: 'relay-1',
  entry_node: 'node-hk',
  entry_name: 'hk-01',
  draft: samplePath,
  published: samplePath,
  serving_path: samplePath,
  serving_revision: 2,
  target_revision: 2,
  observed_revision: 2,
  observed_at: '2026-11-28T10:00:00Z',
  verified_at: '2026-11-28T10:01:00Z',
  public_stale: false,
  online: true,
  applied_running: true,
  cleanup_only: false,
  probe_capable: true,
  stopped_at: '',
  removed_at: '',
  task_id: 'task-1',
  task_state: 'succeeded',
  task_at: '2026-11-28T10:00:00Z',
  error_code: '',
  reason: 'available',
  can_manage: true,
  affected: [],
};

describe('relay-link', () => {
  it('extracts IPv4 and IPv6 endpoints from direct connection URLs', () => {
    expect(extractConnectionEndpoint(directV4)).toBe('198.51.100.20:443');
    expect(extractConnectionEndpoint(directV6)).toBe('[2001:db8::20]:443');
  });

  it('replaces host, port, and fragment while preserving UUID and REALITY query params verbatim', () => {
    const relayed = buildRelayConnectionUrl(
      directV4,
      { host: '203.0.113.10', port: 30001 },
      'hk-01 / 日本专线',
    );
    expect(relayed).toBe(
      `vless://12345678-1234-4234-8234-123456789012@203.0.113.10:30001?encryption=none&flow=xtls-rprx-vision&fp=chrome&pbk=PUBKEY123&security=reality&sid=aabb&sni=example.com&type=tcp#${encodeURIComponent('hk-01 / 日本专线')}`,
    );

    const relayedV6 = buildRelayConnectionUrl(
      directV6,
      { host: '2001:db8::99', port: 10080 },
      'hk-v6',
    );
    expect(relayedV6).toBe(
      'vless://12345678-1234-4234-8234-123456789012@[2001:db8::99]:10080?encryption=none&security=reality&type=tcp#hk-v6',
    );
  });

  it('avoids duplicating entry name in relay fragment', () => {
    expect(relayFragmentName(baseRoute, '日本专线')).toBe('hk-01 / 日本专线');
    expect(relayFragmentName(baseRoute, 'hk-01 至 日本专线')).toBe('hk-01 至 日本专线');
  });

  it('classifies and orders verified, testable published, and disabled relays', () => {
    const draftRoute: RelayRoute = {
      ...baseRoute,
      id: 'relay-draft',
      reason: 'draft',
      published: undefined,
      serving_path: undefined,
      target_revision: 0,
    };
    const pendingPublic: RelayRoute = {
      ...baseRoute,
      id: 'relay-pending',
      reason: 'awaiting_public',
      serving_path: undefined,
    };
    const landingChanged: RelayRoute = {
      ...baseRoute,
      id: 'relay-changed',
      reason: 'landing_changed',
      serving_path: undefined,
    };

    const options = classifyRelayOptions([draftRoute, landingChanged, pendingPublic, baseRoute]);
    expect(options.map((o) => [o.route.id, o.selectable, o.verified])).toEqual([
      ['relay-1', true, true],
      ['relay-pending', true, false],
      ['relay-draft', false, false],
      ['relay-changed', false, false],
    ]);
  });
});
