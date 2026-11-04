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
