import type { Session } from './auth';
import { apiRequest } from './client';

export interface PresetConfig {
  name: string;
  protocol: 'vless';
  port: number;
  transport: 'xhttp' | 'tcp' | 'ws';
  security: 'reality' | 'tls';
  site: 'local' | 'external' | '';
  target: string;
  short_ids: string[];
  fingerprint: string;
  certificate: 'letsencrypt' | 'self_signed' | '';
  server_name: string;
  cdn_host: string;
  path: string;
}
export interface ProtocolPreset {
  id: string;
  config: PresetConfig;
  created_at: string;
  referenceable: boolean;
  reference_issues: Record<string, string>;
}
export const listProtocolPresets = (after = '', signal?: AbortSignal) =>
  apiRequest<{ items: ProtocolPreset[]; next_cursor: string }>('/protocol-presets', {
    query: { after, limit: 50 },
    signal,
  });
export const createProtocolPreset = (config: PresetConfig, session: Session) =>
  apiRequest<ProtocolPreset>('/protocol-presets', {
    method: 'POST',
    json: config,
    csrfToken: session.csrf_token,
  });
export const transportLabel = (value: string) =>
  ({ tcp: 'TCP (RAW + Vision)', xhttp: 'XHTTP', ws: 'WebSocket' })[value] ?? value;

export interface PresetDetail extends ProtocolPreset {
  digest: string;
}
export interface PresetEdit {
  config: PresetConfig;
  base_digest: string;
  confirmation: string;
}
export interface PresetImpact {
  engine_id: string;
  node_id: string;
  node_name: string;
  node_state: string;
  engine: string;
  run_intent: string;
  changed: boolean;
  draft_only: boolean;
  issue: string;
  shared_services: string[];
  services: {
    id: string;
    name: string;
    port_overridden: boolean;
    sni_overridden: boolean;
    before_port: number;
    after_port: number;
    before_sni: string;
    after_sni: string;
  }[];
}
export interface PresetImpactPreview {
  before: PresetConfig;
  config: PresetConfig;
  confirmation: string;
  impacts: PresetImpact[];
}
export const getProtocolPreset = (id: string, signal?: AbortSignal) =>
  apiRequest<PresetDetail>(`/protocol-presets/${id}`, { signal });
export const previewProtocolPreset = (id: string, edit: PresetEdit, session: Session) =>
  apiRequest<PresetImpactPreview>(`/protocol-presets/${id}/preview`, {
    method: 'POST',
    json: edit,
    csrfToken: session.csrf_token,
  });
export const updateProtocolPreset = (id: string, edit: PresetEdit, session: Session) =>
  apiRequest<PresetDetail>(`/protocol-presets/${id}`, {
    method: 'PUT',
    json: edit,
    csrfToken: session.csrf_token,
  });
