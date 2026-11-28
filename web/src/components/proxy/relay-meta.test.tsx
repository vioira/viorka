import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { RelayPath, RelayRoute } from '@/api/relays';
import type { DraftChange } from '@/views/node-details/components/engine-draft-diff';
import RelayChainStrip from './RelayChainStrip';
import {
  endpointText,
  findAffectedRelaysForDraftChanges,
  isNatMapped,
  isRelayAttention,
  isRelayPending,
  relayStatusLabel,
  relayTone,
  relayVerificationSteps,
  summarizeServiceRelays,
} from './relay-meta';

const basePath: RelayPath = {
  name: '香港 至 日本落地',
  engine_id: 'realm-hk',
  landing_engine_id: 'sb-jp',
  landing_service_id: 'svc-jp-1',
  version: 2,
  landing_revision: 4,
  public: { host: '203.0.113.10', port: 30001 },
  listen: { host: '0.0.0.0', port: 10080 },
  dial: { host: '198.51.100.20', port: 443 },
  landing_listen: { host: '::', port: 443 },
  landing_name: 'jp-vless-reality',
};

const basePublicProbe: NonNullable<RelayRoute['public_probe']> = {
  id: 'probe-1',
  revision: 3,
  endpoint: basePath.public,
  address: '203.0.113.10',
  state: 'passed',
  source: 'external',
  detail: '',
  at: '2026-11-28T10:01:00Z',
};

const baseRoute: RelayRoute = {
  id: 'relay-1',
  entry_node: 'node-hk',
  entry_name: 'hk-nat-01',
  draft: basePath,
  published: basePath,
  serving_path: basePath,
  serving_revision: 3,
  target_revision: 3,
  observed_revision: 3,
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
  task_at: '2026-11-28T10:00:05Z',
  error_code: '',
  reason: 'available',
  can_manage: true,
  affected: ['香港 至 新加坡'],
  public_probe: basePublicProbe,
};

describe('relay-meta status & verification model', () => {
  it('detects NAT port mapping and formats IPv6 endpoints cleanly', () => {
    expect(isNatMapped(basePath)).toBe(true);
    expect(isNatMapped({ ...basePath, listen: { host: '0.0.0.0', port: 30001 } })).toBe(false);
    expect(endpointText({ host: '2001:db8::1', port: 10080 })).toBe('[2001:db8::1]:10080');
  });

  it('classifies healthy, pending, and attention routes accurately', () => {
    expect(relayStatusLabel(baseRoute)).toBe('可供订阅');
    expect(relayTone(baseRoute)).toBe('success');
    expect(isRelayPending(baseRoute)).toBe(false);
    expect(isRelayAttention(baseRoute)).toBe(false);

    const offlineAvailable: RelayRoute = { ...baseRoute, online: false };
    expect(relayTone(offlineAvailable)).toBe('warning');
    expect(isRelayAttention(offlineAvailable)).toBe(true);

    const checkingPublic: RelayRoute = {
      ...baseRoute,
      reason: 'awaiting_public',
      serving_revision: 0,
      serving_path: undefined,
      public_probe: { ...basePublicProbe, state: 'checking' },
    };
    expect(relayStatusLabel(checkingPublic)).toBe('公网检测中');
    expect(isRelayPending(checkingPublic)).toBe(true);
    expect(isRelayAttention(checkingPublic)).toBe(false);

    const failedApply: RelayRoute = {
      ...baseRoute,
      reason: 'awaiting_apply',
      applied_running: false,
      task_state: 'failed',
    };
    expect(relayStatusLabel(failedApply)).toBe('发布失败');
    expect(relayTone(failedApply)).toBe('danger');
    expect(isRelayPending(failedApply)).toBe(false);
    expect(isRelayAttention(failedApply)).toBe(true);

    const landingChanged: RelayRoute = {
      ...baseRoute,
      reason: 'landing_changed',
      serving_revision: 0,
      serving_path: undefined,
    };
    expect(relayStatusLabel(landingChanged)).toBe('落地连接已变化');
    expect(isRelayAttention(landingChanged)).toBe(true);
  });

  it('produces accurate 3-stage verification steps for healthy and degraded routes', () => {
    const okSteps = relayVerificationSteps(baseRoute);
    expect(okSteps.map((s) => s.state)).toEqual(['passed', 'passed', 'passed']);

    const failedPublic: RelayRoute = {
      ...baseRoute,
      reason: 'public_failed',
      serving_revision: 0,
      serving_path: undefined,
      public_probe: { ...basePublicProbe, state: 'failed', detail: 'refused' },
    };
    const steps = relayVerificationSteps(failedPublic);
    expect(steps.map((s) => s.state)).toEqual(['passed', 'passed', 'failed']);
    expect(steps[2].detail).toContain('拒绝了 TCP 连接');

    const landingChangedSteps = relayVerificationSteps({
      ...baseRoute,
      reason: 'landing_changed',
      serving_revision: 0,
      serving_path: undefined,
    });
    expect(landingChangedSteps[1].state).toBe('failed');
    expect(landingChangedSteps[1].statusText).toBe('落地已变更');
  });

  it('summarizes multiple relays attached to a proxy service', () => {
    const summary = summarizeServiceRelays([
      baseRoute,
      { ...baseRoute, id: 'relay-2', reason: 'draft', target_revision: 0, published: undefined },
      { ...baseRoute, id: 'relay-3', reason: 'public_failed' },
    ]);
    expect(summary).toEqual({ total: 3, available: 1, pending: 1, attention: 1 });
  });

  it('identifies relays impacted by landing service draft changes and ignores benign edits', () => {
    const routes: RelayRoute[] = [
      baseRoute,
      {
        ...baseRoute,
        id: 'relay-removed',
        reason: 'disabled',
        removed_at: '2026-11-28T09:00:00Z',
      },
      {
        ...baseRoute,
        id: 'relay-other',
        draft: { ...basePath, landing_service_id: 'svc-other' },
      },
    ];

    const benignChange: DraftChange[] = [
      {
        id: 'svc-jp-1',
        name: 'jp-vless-reality',
        kind: '修改',
        fields: [{ label: '名称', before: 'old', after: 'new' }],
      },
    ];
    expect(findAffectedRelaysForDraftChanges(routes, benignChange)).toEqual([]);

    const portChange: DraftChange[] = [
      {
        id: 'svc-jp-1',
        name: 'jp-vless-reality',
        kind: '修改',
        fields: [{ label: '公网端口', before: '443', after: '8443' }],
      },
    ];
    const portImpacts = findAffectedRelaysForDraftChanges(routes, portChange);
    expect(portImpacts).toHaveLength(1);
    expect(portImpacts[0].route.id).toBe('relay-1');
    expect(portImpacts[0].reason).toContain('公网端口');

    const deleteChange: DraftChange[] = [
      {
        id: 'svc-jp-1',
        name: 'jp-vless-reality',
        kind: '删除',
        fields: [{ label: '监听端口', before: '443', after: '无' }],
      },
    ];
    const deleteImpacts = findAffectedRelaysForDraftChanges(routes, deleteChange);
    expect(deleteImpacts).toHaveLength(1);
    expect(deleteImpacts[0].changeKind).toBe('删除');
  });
});

describe('RelayChainStrip', () => {
  it('renders bidirectional links to entry node realm and landing proxy service with NAT badge', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RelayChainStrip
          entryName="hk-nat-01"
          entryNodeId="node-hk"
          entryOnline
          publicEndpoint={basePath.public}
          listenEndpoint={basePath.listen}
          dialEndpoint={basePath.dial}
          landingName={basePath.landing_name}
          landingListen={basePath.landing_listen}
          landingEngineId={basePath.landing_engine_id}
          landingServiceId={basePath.landing_service_id}
          landingRevision={4}
        />
      </MemoryRouter>,
    );
    expect(html).toContain('NAT');
    expect(html).toContain('/nodes/node-hk?tab=engines&amp;engine=realm');
    expect(html).toContain('/proxy/services?service=sb-jp%2Fsvc-jp-1');
    expect(html).toContain('203.0.113.10:30001');
    expect(html).toContain('198.51.100.20:443');
  });

  it('hides landing link and indicates revoked export permission when cleanupOnly', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RelayChainStrip
          entryName="hk-nat-01"
          entryNodeId="node-hk"
          publicEndpoint={basePath.public}
          listenEndpoint={basePath.listen}
          landingEngineId={basePath.landing_engine_id}
          landingServiceId={basePath.landing_service_id}
          cleanupOnly
        />
      </MemoryRouter>,
    );
    expect(html).toContain('导出权限已撤销');
    expect(html).not.toContain('/proxy/services?service=');
  });
});
