import { apiRequest } from './client';
import type { EngineRecord, EngineService } from './engines';
import type { NodeRecord } from './nodes';
import type { RelayRoute } from './relays';

export type ServiceNode = Pick<NodeRecord, 'id' | 'name' | 'state' | 'last_seen_at'> & {
  can_manage: boolean;
};
export type ServiceItem = {
  id: string;
  node: ServiceNode;
  engine: Pick<
    EngineRecord,
    | 'id'
    | 'name'
    | 'version'
    | 'status'
    | 'sync_state'
    | 'sync_error'
    | 'sync_error_message'
    | 'desired_revision'
    | 'observed_revision'
  > & { draft_version: number };
  service: EngineService;
  protocol: string;
  preset_name: string;
  runtime: 'unknown' | 'running' | 'degraded' | 'stopped' | 'unpublished';
  configuration: 'pending_delete' | 'draft' | 'failed' | 'pending' | 'synced' | 'unpublished';
  draft_changed: boolean;
  relay_eligible: boolean;
  relays: RelayRoute[];
};
type ServiceList = {
  items: ServiceItem[];
  selected?: ServiceItem;
  next_cursor?: string;
  counts: { all: number; running: number; pending: number; attention: number };
  nodes: ServiceNode[];
  restricted: boolean;
  managed_relay_count: number;
};
export type ServiceFilters = {
  status?: 'running' | 'pending' | 'attention';
  access?: 'direct' | 'relayed';
  engine?: string;
  node?: string;
  q?: string;
};
export const listProxyServices = (
  query: ServiceFilters & { after?: string; selected?: string },
  signal: AbortSignal,
) => apiRequest<ServiceList>('/proxy/services', { query, signal });
