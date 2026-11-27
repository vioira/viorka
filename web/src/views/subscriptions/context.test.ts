import { describe, expect, it } from 'vitest';
import type { RecoveryStatus } from '@/api/subscriptions';
import { accessResultTone, serviceRefKey, unavailableReasonLabel } from './components/service-meta';
import { isRecoveryPending } from './context';

const baseRecovery: RecoveryStatus = {
  changes: [],
  engine_id: 'eng-1',
  engine_name: 'xray',
  node_id: 'node-1',
  node_name: 'HK-Edge-01',
  node_state: 'online',
  runtime_status: 'running',
  state: 'matched',
  task_id: '',
  task_state: 'succeeded',
  error_code: '',
  observed_revision: 1,
  draft_needs_review: false,
  services: [],
};

describe('subscription recovery pending invariant', () => {
  it('marks pending and mismatch states as pending', () => {
    expect(isRecoveryPending({ ...baseRecovery, state: 'pending' })).toBe(true);
    expect(isRecoveryPending({ ...baseRecovery, state: 'mismatch' })).toBe(true);
  });

  it('requires confirmation only for enabled non-removed services once matched', () => {
    expect(
      isRecoveryPending({
        ...baseRecovery,
        services: [
          {
            id: 'svc-1',
            name: 'HK-Vision',
            public_host: 'hk.example.net',
            public_port: 443,
            change: 'unchanged',
            credentials_changed: false,
            confirmed: false,
            enabled: true,
          },
        ],
      }),
    ).toBe(true);

    expect(
      isRecoveryPending({
        ...baseRecovery,
        services: [
          {
            id: 'svc-1',
            name: 'HK-Vision',
            public_host: 'hk.example.net',
            public_port: 443,
            change: 'unchanged',
            credentials_changed: false,
            confirmed: true,
            enabled: true,
          },
          {
            id: 'svc-removed',
            name: 'Old',
            public_host: '',
            public_port: 0,
            change: 'removed',
            credentials_changed: false,
            confirmed: false,
            enabled: true,
          },
          {
            id: 'svc-disabled',
            name: 'Disabled',
            public_host: '',
            public_port: 0,
            change: 'unchanged',
            credentials_changed: false,
            confirmed: false,
            enabled: false,
          },
        ],
      }),
    ).toBe(false);
  });
});

describe('subscription service metadata helpers', () => {
  it('builds stable ref keys and maps result tones and reasons', () => {
    expect(serviceRefKey({ node_id: 'n1', engine_id: 'e1', service_id: 's1' })).toBe('n1:e1:s1');
    expect(accessResultTone('ok')).toBe('success');
    expect(accessResultTone('unrecognized')).toBe('warning');
    expect(accessResultTone('no_services')).toBe('danger');
    expect(accessResultTone('other')).toBe('neutral');
    expect(unavailableReasonLabel('restore_verification_required')).toBe('等待恢复核对');
    expect(unavailableReasonLabel('unknown_reason')).toBe('服务不可用');
  });
});
