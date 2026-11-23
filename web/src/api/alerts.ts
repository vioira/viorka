import { apiRequest } from './client';

export const metricLabels = {
  cpu: 'CPU 使用率',
  memory: '内存使用率',
  disk: '文件系统使用率',
  upload: '上行速率',
  download: '下行速率',
  offline: '节点离线',
  monthly: '月流量用量',
} as const;
export type Metric = keyof typeof metricLabels;
export interface AlertRule {
  id: string;
  name: string;
  metric: Metric;
  mode: 'average' | 'all' | 'duration' | 'gb' | 'percent';
  threshold: number;
  window_minutes: number;
  repeat_minutes: number;
  enabled: boolean;
  recovery: boolean;
  nodes: string[];
  channels: string[];
  template: string;
}
export interface AlertChannel {
  id: string;
  name: string;
  kind: 'telegram' | 'bark';
  target: string;
}
export interface AlertMessage {
  title: string;
  body: string;
}
export type EventMessages = Record<'trigger' | 'repeat' | 'recovery', AlertMessage>;
export interface AlertTemplate extends EventMessages {
  id: string;
  name: string;
}
export interface AlertConfig {
  revision: number;
  timezone: string;
  rules: AlertRule[];
  templates: AlertTemplate[];
  channels: AlertChannel[];
}
export interface AlertSettings {
  config: AlertConfig;
  credentials: Record<string, boolean>;
  delivery: Record<string, { state: string; at: string; detail: string }>;
}
const path = '/settings/notifications';
export const getAlertSettings = (signal?: AbortSignal) =>
  apiRequest<AlertSettings>(path, { signal });
export const saveAlertSettings = (
  csrfToken: string,
  config: AlertConfig,
  secrets?: Record<string, string>,
) => apiRequest<AlertSettings>(path, { method: 'PUT', csrfToken, json: { config, secrets } });
export const testAlertChannel = (csrfToken: string, id: string) =>
  apiRequest(`${path}/channels/${id}/test`, { method: 'POST', csrfToken, responseType: 'void' });
export const previewAlertTemplate = (
  csrfToken: string,
  template: AlertTemplate,
  timezone: string,
  signal?: AbortSignal,
) =>
  apiRequest<EventMessages>(`${path}/preview`, {
    method: 'POST',
    csrfToken,
    signal,
    json: { template, timezone },
  });

export interface AlertNodeStatus {
  id: string;
  name: string;
  state: string;
  active: boolean;
}
export const getAlertRuleStatus = (id: string, after: string, signal: AbortSignal) =>
  apiRequest<{ items: AlertNodeStatus[]; next_cursor: string }>(`${path}/rules/${id}/status`, {
    query: { after },
    signal,
  });
