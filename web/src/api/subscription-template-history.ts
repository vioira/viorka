import type { Session } from './auth';
import { apiRequest } from './client';
import type { SubscriptionTemplate, SubscriptionTemplateEdit } from './subscriptions';

export interface AffectedSubscription {
  id: string;
  name: string;
  owner_name: string;
}

export interface TemplateComparison {
  services: number;
  changed: boolean;
  start_line: number;
  before: string;
  after: string;
  truncated: boolean;
  before_invalid: boolean;
  after_invalid: boolean;
}

export const listTemplateImpact = (id: string, after: string, signal?: AbortSignal) =>
  apiRequest<{ items: AffectedSubscription[]; next_cursor: string }>(
    `/subscription-templates/${id}/impact`,
    { query: { limit: 25, after }, signal },
  );

export const compareTemplate = (
  id: string,
  subscriptionID: string,
  template: SubscriptionTemplateEdit,
  userAgent: string,
  params: Record<string, string>,
  session: Session,
  signal?: AbortSignal,
) =>
  apiRequest<TemplateComparison>(`/subscription-templates/${id}/compare`, {
    method: 'POST',
    csrfToken: session.csrf_token,
    json: { subscription_id: subscriptionID, template, request: { user_agent: userAgent, params } },
    signal,
  });

export interface TemplateRevision {
  version: number;
  archived_at: string;
}
export const listTemplateHistory = (id: string, signal?: AbortSignal) =>
  apiRequest<{ items: TemplateRevision[] }>(`/subscription-templates/${id}/history`, { signal });
export const getTemplateVersion = (id: string, version: number, signal?: AbortSignal) =>
  apiRequest<SubscriptionTemplate>(`/subscription-templates/${id}/history/${version}`, { signal });
export const restoreTemplateVersion = (
  source: SubscriptionTemplate,
  version: number,
  session: Session,
) =>
  apiRequest<SubscriptionTemplate>(`/subscription-templates/${source.id}/restore`, {
    method: 'POST',
    csrfToken: session.csrf_token,
    json: {
      version: source.version,
      source_version: version,
      expected_references: source.references,
      confirm: true,
    },
  });
