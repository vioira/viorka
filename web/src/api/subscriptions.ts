import type { Session } from './auth';
import { apiRequest } from './client';
import type { TaskRecord } from './tasks';

export type SubscriptionFormat = 'mihomo' | 'sing-box' | 'loon';
export interface SubscriptionCondition {
  kind: 'contains' | 'regex';
  pattern: string;
}
export interface SubscriptionRule {
  id: string;
  name: string;
  format: SubscriptionFormat;
  conditions: SubscriptionCondition[];
  position: number;
  version: number;
  references: number;
  enabled: boolean;
}
export interface SubscriptionRuleEdit {
  name: string;
  format: SubscriptionFormat;
  conditions: SubscriptionCondition[];
  position: number;
  version: number;
  expected_references: number;
  enabled: boolean;
  confirm: boolean;
}
export interface ServiceRef {
  node_id: string;
  engine_id: string;
  service_id: string;
}
export interface SubscriptionService extends ServiceRef {
  node_name: string;
  engine: string;
  protocol: string;
  service_name: string;
  status: 'available' | 'pending' | 'invalid' | 'unavailable' | 'forbidden';
  reason: string;
  public_host: string;
  public_port: number;
  incompatible_formats: SubscriptionFormat[];
}
export interface SubscriptionItem {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
  rule_ids: string[];
  services: SubscriptionService[];
  mihomo_port: number;
  version: number;
  revoked: boolean;
}
export interface SubscriptionEdit {
  name: string;
  rule_ids: string[];
  services: ServiceRef[];
  reselect?: ServiceRef[];
  mihomo_port: number;
  version: number;
}
export interface SubscriptionIssued {
  subscription: SubscriptionItem;
  url: string;
  format_urls: Partial<Record<SubscriptionFormat, string>>;
}
export interface SubscriptionAccess {
  id: number;
  at: string;
  user_agent: string;
  rule_id: string;
  format: string;
  result: string;
}
export interface RecoveryService {
  id: string;
  name: string;
  public_host: string;
  public_port: number;
  change: 'added' | 'changed' | 'removed' | 'unchanged';
  credentials_changed: boolean;
  confirmed: boolean;
  enabled: boolean;
}
export interface RecoveryStatus {
  changes: RecoveryChange[];
  engine_id: string;
  engine_name: string;
  node_id: string;
  node_name: string;
  node_state: string;
  runtime_status: string;
  state: 'pending' | 'matched' | 'mismatch';
  task_id: string;
  task_state: string;
  error_code: string;
  observed_revision: number;
  draft_needs_review: boolean;
  services: RecoveryService[];
}

export interface RecoveryChange {
  resource: string;
  field: string;
  before: string;
  after: string;
}

export const listSubscriptionRules = (signal?: AbortSignal) =>
  apiRequest<{ items: SubscriptionRule[] }>('/subscription-rules', { signal });
export const saveSubscriptionRule = (
  rule: SubscriptionRule | null,
  edit: SubscriptionRuleEdit,
  session: Session,
) =>
  apiRequest<SubscriptionRule>(rule ? `/subscription-rules/${rule.id}` : '/subscription-rules', {
    method: rule ? 'PUT' : 'POST',
    csrfToken: session.csrf_token,
    json: edit,
  });
export const deleteSubscriptionRule = (rule: SubscriptionRule, session: Session) =>
  apiRequest(`/subscription-rules/${rule.id}`, {
    method: 'DELETE',
    csrfToken: session.csrf_token,
    json: { version: rule.version },
    responseType: 'void',
  });
export const testSubscriptionRules = (userAgent: string, session: Session) =>
  apiRequest<{ matched: boolean; rule_id: string; format: string }>('/subscription-rules/test', {
    method: 'POST',
    csrfToken: session.csrf_token,
    json: { user_agent: userAgent, rule_ids: [] },
  });
export const listSubscriptionCandidates = (after = '', signal?: AbortSignal) =>
  apiRequest<{ items: SubscriptionService[]; next_cursor: string }>('/subscriptions/candidates', {
    query: { after, limit: 20 },
    signal,
  });
export const listSubscriptions = (after = '', signal?: AbortSignal) =>
  apiRequest<{ items: SubscriptionItem[]; next_cursor: string }>('/subscriptions', {
    query: { after, limit: 50 },
    signal,
  });
export const createSubscription = (edit: SubscriptionEdit, session: Session) =>
  apiRequest<SubscriptionIssued>('/subscriptions', {
    method: 'POST',
    csrfToken: session.csrf_token,
    json: edit,
  });
export const updateSubscription = (id: string, edit: SubscriptionEdit, session: Session) =>
  apiRequest<SubscriptionItem>(`/subscriptions/${id}`, {
    method: 'PUT',
    csrfToken: session.csrf_token,
    json: edit,
  });
export const rotateSubscription = (item: SubscriptionItem, session: Session, revoke = false) =>
  apiRequest<SubscriptionIssued>(`/subscriptions/${item.id}/${revoke ? 'revoke' : 'rotate'}`, {
    method: 'POST',
    csrfToken: session.csrf_token,
    json: { version: item.version },
  });
export const deleteSubscription = (item: SubscriptionItem, session: Session) =>
  apiRequest(`/subscriptions/${item.id}`, {
    method: 'DELETE',
    csrfToken: session.csrf_token,
    json: { version: item.version },
    responseType: 'void',
  });
export const listSubscriptionAccess = (item: SubscriptionItem, signal?: AbortSignal) =>
  apiRequest<{ items: SubscriptionAccess[] }>(`/subscriptions/${item.id}/access`, { signal });
export const clearSubscriptionAccess = (item: SubscriptionItem, session: Session) =>
  apiRequest(`/subscriptions/${item.id}/access`, {
    method: 'DELETE',
    csrfToken: session.csrf_token,
    responseType: 'void',
  });
export const listSubscriptionRecoveries = (after = '', signal?: AbortSignal) =>
  apiRequest<{ items: RecoveryStatus[]; next_cursor: string }>('/subscription-recovery', {
    query: { after, limit: 20 },
    signal,
  });
export const getSubscriptionRecovery = (id: string, signal?: AbortSignal) =>
  apiRequest<RecoveryStatus>(`/subscription-recovery/${id}`, { signal });
export const checkSubscriptionRecovery = (engine: RecoveryStatus, key: string, session: Session) =>
  apiRequest<TaskRecord>(`/subscription-recovery/${engine.engine_id}/check`, {
    method: 'POST',
    csrfToken: session.csrf_token,
    json: { idempotency_key: key },
  });
export const adoptSubscriptionRecovery = (engine: RecoveryStatus, session: Session) =>
  apiRequest(`/subscription-recovery/${engine.engine_id}/adopt`, {
    method: 'POST',
    csrfToken: session.csrf_token,
    json: { task_id: engine.task_id, confirm: true },
    responseType: 'void',
  });
export const confirmSubscriptionEndpoint = (
  engine: RecoveryStatus,
  service: RecoveryService,
  host: string,
  port: number,
  session: Session,
) =>
  apiRequest(`/subscription-recovery/${engine.engine_id}/endpoint`, {
    method: 'POST',
    csrfToken: session.csrf_token,
    json: {
      service_id: service.id,
      expected_host: service.public_host,
      expected_port: service.public_port,
      public_host: host,
      public_port: port,
      confirm: true,
    },
    responseType: 'void',
  });
