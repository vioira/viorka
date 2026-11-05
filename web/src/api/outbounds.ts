import type { Session } from './auth';
import { apiRequest } from './client';
export interface OutboundConfig {
  id: string;
  name: string;
  type: 'vless' | 'socks' | 'http';
  server: string;
  server_port: number;
  username?: string;
  password?: string;
  uuid?: string;
  tls?: boolean;
  server_name?: string;
  public_key?: string;
  short_id?: string;
  flow?: string;
  fingerprint?: string;
}
export interface Outbound {
  id: string;
  version: number;
  config: OutboundConfig;
  has_password: boolean;
  has_uuid: boolean;
  references: number;
}
export interface OutboundImpact {
  node_id: string;
  node_name: string;
  engine_id: string;
  state: string;
  draft_only: boolean;
}
export interface OutboundPreview {
  impacts: OutboundImpact[];
  confirmation: string;
}
export interface RouteRule {
  id: string;
  name: string;
  enabled: boolean;
  inbound?: string[];
  domain?: string[];
  domain_suffix?: string[];
  ip_cidr?: string[];
  port?: number[];
  port_range?: string[];
  network?: string[];
  outbound: string;
  match_all: boolean;
}
export interface EngineRouting {
  outbound_ids: string[];
  rules: RouteRule[];
  final: string;
  sniff: boolean;
}
export const defaultRouting = (): EngineRouting => ({
  outbound_ids: [],
  rules: [],
  final: 'direct',
  sniff: true,
});
export const newOutbound = (): OutboundConfig => ({
  id: '',
  name: '',
  type: 'vless',
  server: '',
  server_port: 443,
  tls: true,
  uuid: '',
  server_name: '',
  public_key: '',
  short_id: '',
  flow: 'xtls-rprx-vision',
  fingerprint: 'chrome',
});
export const listOutbounds = (after = '', signal?: AbortSignal) =>
  apiRequest<{ items: Outbound[]; next_cursor: string }>('/outbounds', {
    query: { after, limit: 100 },
    signal,
  });
export async function allOutbounds(signal?: AbortSignal) {
  const items: Outbound[] = [];
  let after = '';
  do {
    const page = await listOutbounds(after, signal);
    items.push(...page.items);
    after = page.next_cursor;
    if (items.length > 5000) throw new Error('出口数量超过选择器上限，请精简出口配置。');
  } while (after);
  return items;
}
export const parseOutbound = (link: string, session: Session) =>
  apiRequest<OutboundConfig>('/outbounds/parse', {
    method: 'POST',
    csrfToken: session.csrf_token,
    json: { link },
  });
export const previewOutbound = (o: Outbound, config: OutboundConfig, session: Session) =>
  apiRequest<OutboundPreview>(`/outbounds/${o.id}/preview`, {
    method: 'POST',
    csrfToken: session.csrf_token,
    json: { config, version: o.version, confirmation: '' },
  });
export const saveOutbound = (
  o: Outbound | null,
  config: OutboundConfig,
  confirmation: string,
  session: Session,
) =>
  apiRequest<Outbound>(o ? `/outbounds/${o.id}` : '/outbounds', {
    method: o ? 'PUT' : 'POST',
    csrfToken: session.csrf_token,
    json: { config, version: o?.version ?? 0, confirmation },
  });
export const deleteOutbound = (o: Outbound, session: Session) =>
  apiRequest(`/outbounds/${o.id}`, {
    method: 'DELETE',
    csrfToken: session.csrf_token,
    json: { version: o.version },
    responseType: 'void',
  });

export const copyOutbound = (o: Outbound, name: string, session: Session) =>
  apiRequest<Outbound>(`/outbounds/${o.id}/copy`, {
    method: 'POST',
    csrfToken: session.csrf_token,
    json: { name },
  });
