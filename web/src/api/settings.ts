import type { Session } from './auth';
import { apiRequest } from './client';
export interface PanelSettings {
  revision: number;
  panel_name: string;
  public_origin: string;
  theme: 'dark' | 'light' | 'system';
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
}
export interface BackupList {
  items: Backup[];
  pending_restore: string;
  retention_days: number;
}
export interface Notification {
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
export const listBackups = (signal?: AbortSignal) => apiRequest<BackupList>('/backups', { signal });
export const createBackup = (session: Session) =>
  apiRequest<Backup>('/backups', { method: 'POST', csrfToken: session.csrf_token });
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
