import type { Session } from './auth';
import { apiRequest } from './client';
import type { EngineRecord } from './engines';
import type { SubscriptionService } from './subscriptions';

export interface Endpoint {
  host: string;
  port: number;
}
export interface RelayEdit {
  name: string;
  engine_id: string;
  landing_engine_id: string;
  landing_service_id: string;
  version: number;
  landing_revision: number;
  public: Endpoint;
  listen: Endpoint;
}
export interface RelayPath extends RelayEdit {
  dial: Endpoint;
  landing_listen: Endpoint;
  landing_name: string;
}
export interface RelayPublicProbe {
  address: string;
  id: string;
  revision: number;
  endpoint: Endpoint;
  state: 'queued' | 'checking' | 'passed' | 'failed' | 'unavailable';
  source: string;
  detail: string;
  at: string;
}
export interface RelayRoute {
  public_probe?: RelayPublicProbe;
  publish_base?: { revision: number; draft_version: number; starts_realm: boolean };
  serving_revision: number;
  serving_path?: RelayPath;
  verified_at: string;
  public_stale: boolean;
  online: boolean;
  applied_running: boolean;
  cleanup_only: boolean;
  probe_capable: boolean;
  probe?: {
    task_id: string;
    state: string;
    at: string;
    listen: string;
    dial: string;
    error_code: string;
  };
  id: string;
  entry_node: string;
  entry_name: string;
  draft: RelayPath;
  published?: RelayPath;
  target_revision: number;
  observed_revision: number;
  observed_at: string;
  stopped_at: string;
  removed_at: string;
  task_id: string;
  task_state: string;
  task_at: string;
  error_code: string;
  reason: string;
  can_manage: boolean;
  affected: string[];
}
export interface RelayEntry {
  id: string;
  node_id: string;
  name: string;
  public_host: string;
}
export interface RelayList {
  items: RelayRoute[];
  next_cursor?: string;
}
export const listRelays = (
  engine: string | undefined,
  service: string | undefined,
  after: string | undefined,
  signal: AbortSignal,
  entry?: string,
) =>
  apiRequest<RelayList>('/relays', {
    query: { landing_engine: engine, entry_engine: entry, service, after },
    signal,
  });
export const getRelay = (id: string, signal: AbortSignal) =>
  apiRequest<RelayRoute>(`/relays/${id}`, { signal });
export const listRelayLandings = (after: string, q: string, signal: AbortSignal) =>
  apiRequest<{ items: SubscriptionService[]; next_cursor: string }>('/relay-landings', {
    query: { after, q },
    signal,
  });
export const getLanding = (engine: string, service: string, signal: AbortSignal) =>
  apiRequest<RelayPath>(`/engines/${engine}/services/${service}/relay-landing`, { signal });
export async function getRelayEntries(signal: AbortSignal) {
  const entries: RelayEntry[] = [];
  let after: string | undefined;
  do {
    const page = await apiRequest<{ items: RelayEntry[]; next_cursor?: string }>('/relay-entries', {
      query: { after },
      signal,
    });
    entries.push(...page.items);
    after = page.next_cursor;
  } while (after);
  return entries;
}
export const saveRelay = (id: string | undefined, edit: RelayEdit, session: Session) =>
  apiRequest<RelayRoute>(id ? `/relays/${id}` : '/relays', {
    method: id ? 'PUT' : 'POST',
    json: edit,
    csrfToken: session.csrf_token,
  });
export const submitRelay = (
  r: RelayRoute,
  op: 'publish' | 'withdraw' | 'probe',
  key: string,
  session: Session,
) =>
  apiRequest<{ id: string }>(`/relays/${r.id}/${op}`, {
    method: 'POST',
    json: {
      version: op === 'probe' ? r.target_revision : r.draft.version,
      request_key: key,
      review: op === 'publish' ? r.publish_base : undefined,
    },
    csrfToken: session.csrf_token,
  });
export const retestPublic = (route: RelayRoute, check: RelayPublicProbe, session: Session) =>
  apiRequest<RelayPublicProbe>(`/relays/${route.id}/public-probe`, {
    method: 'POST',
    json: { revision: route.target_revision, check_id: check.id },
    csrfToken: session.csrf_token,
  });
export const deleteRelay = (r: RelayRoute, session: Session) =>
  apiRequest(`/relays/${r.id}`, {
    method: 'DELETE',
    json: { version: r.draft.version },
    csrfToken: session.csrf_token,
    responseType: 'void',
  });

export function hasPublishedRelayLanding(engine: EngineRecord, serviceId: string) {
  return (
    engine.status === 'running' &&
    engine.run_intent === 'running' &&
    !engine.sync_error &&
    engine.published_revision > 0 &&
    engine.observed_revision >= engine.published_revision &&
    !!engine.published_draft?.services.some(
      (s) => s.id === serviceId && s.enabled && !s.pending_delete && s.public_host && s.public_port,
    )
  );
}

export function relayTargetsPreviousLanding(route: RelayRoute) {
  const path = route.serving_path ?? route.published;
  return Boolean(
    path &&
      (path.landing_engine_id !== route.draft.landing_engine_id ||
        path.landing_service_id !== route.draft.landing_service_id),
  );
}
