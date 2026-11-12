import type { Session } from './auth';
import { apiRequest } from './client';
export interface PanelSettings {
  tcp_probe_targets?: string[];
  revision: number;
  panel_name: string;
  public_origin: string;
  heartbeat_timeout_seconds: number;
  sse: boolean;
  alerts: boolean;
  auto_backup: boolean;
  telemetry: boolean;
}
export interface SettingsResponse {
  settings: PanelSettings;
  active_origin: string;
}
export interface Backup {
  id: string;
  created_at: string;
  size: number;
  status: 'running' | 'succeeded' | 'failed';
  filename: string;
  trigger: 'manual' | 'scheduled';
  expires_at: string | null;
}
export interface BackupList {
  items: Backup[];
  pending_restore: string;
  next_cursor: string;
  retention_days: number;
}
export interface Notification {
  read: boolean;
  id: string;
  node_id: string;
  created_at: string;
  message: string;
}
export const getSettings = (signal?: AbortSignal) =>
  apiRequest<SettingsResponse>('/settings', { signal });
export const saveSettings = (session: Session, settings: PanelSettings) =>
  apiRequest<SettingsResponse>('/settings', {
    method: 'PUT',
    csrfToken: session.csrf_token,
    json: settings,
  });
export const changePassword = (session: Session, current_password: string, new_password: string) =>
  apiRequest('/auth/password', {
    method: 'POST',
    csrfToken: session.csrf_token,
    json: { current_password, new_password },
    responseType: 'void',
  });
export const logoutAll = (session: Session) =>
  apiRequest('/auth/logout-all', {
    method: 'POST',
    csrfToken: session.csrf_token,
    responseType: 'void',
  });
export const listBackups = (signal?: AbortSignal, after?: string) =>
  apiRequest<BackupList>('/backups', { signal, query: { after } });
export const createBackup = (session: Session) =>
  apiRequest<Backup>('/backups', {
    method: 'POST',
    csrfToken: session.csrf_token,
    timeoutMs: 180000,
  });
export const restoreBackup = (session: Session, id: string, current_password: string) =>
  apiRequest<{ state: 'pending_restart'; id: string }>('/backups/restore', {
    method: 'POST',
    csrfToken: session.csrf_token,
    json: { id, current_password },
  });
export const cancelRestore = (session: Session) =>
  apiRequest('/backups/restore', {
    method: 'DELETE',
    csrfToken: session.csrf_token,
    responseType: 'void',
  });
export const listNotifications = (signal?: AbortSignal) =>
  apiRequest<{ items: Notification[] }>('/notifications', { signal });

export const setNotificationRead = (session: Session, id: string, read: boolean) =>
  apiRequest(`/notifications/${encodeURIComponent(id)}/read`, {
    method: 'PUT',
    csrfToken: session.csrf_token,
    json: { read },
    responseType: 'void',
  });

export const markNotificationsRead = (session: Session, ids: string[]) =>
  apiRequest('/notifications/read', {
    method: 'PUT',
    csrfToken: session.csrf_token,
    json: { ids },
    responseType: 'void',
  });

export interface BackupPolicy {
  revision: number;
  enabled: boolean;
  cron: string;
  retention_days: number;
  max_copies: number;
  s3: {
    enabled: boolean;
    endpoint: string;
    region: string;
    bucket: string;
    prefix: string;
    access_key: string;
    secret_key?: string;
    secret_configured: boolean;
    path_style: boolean;
  };
}
export const getBackupPolicy = (signal?: AbortSignal) =>
  apiRequest<BackupPolicy>('/backups/policy', { signal });
export const saveBackupPolicy = (session: Session, policy: BackupPolicy) =>
  apiRequest<BackupPolicy>('/backups/policy', {
    method: 'PUT',
    csrfToken: session.csrf_token,
    json: policy,
  });
export const deleteBackup = (session: Session, id: string) =>
  apiRequest(`/backups/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    csrfToken: session.csrf_token,
    responseType: 'void',
    timeoutMs: 180000,
  });
export async function downloadBackup(id: string, signal: AbortSignal) {
  const response = await fetch(`/api/v1/backups/${encodeURIComponent(id)}/download`, {
    credentials: 'same-origin',
    redirect: 'error',
    signal,
  });
  if (!response.ok) throw new Error('下载备份失败，请刷新记录后重试。');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${id}.backup`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
