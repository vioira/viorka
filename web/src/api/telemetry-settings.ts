import type { Session } from './auth';
import { ApiError, apiRequest } from './client';
import { isTelemetrySettings, type TelemetrySettings } from './telemetry';
export type TelemetrySettingsResult = {
  revision: number;
  applied_revision: number;
  state: 'applied' | 'failed';
  error_code?: 'invalid_settings' | 'stale_revision' | 'revision_conflict' | 'persist_failed';
};
export type TelemetrySettingsStatus = {
  state: 'pending' | 'applied' | 'failed';
  result?: TelemetrySettingsResult;
};
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const revision = (v: unknown, min: number): v is number =>
  Number.isSafeInteger(v) && (v as number) >= min;
export function parseTelemetrySettingsStatus(v: unknown): TelemetrySettingsStatus {
  if (record(v)) {
    if (v.state === 'pending' && v.result === undefined) return { state: 'pending' };
    const r = v.result;
    if (
      record(r) &&
      (v.state === 'applied' || v.state === 'failed') &&
      r.state === v.state &&
      revision(r.revision, 1) &&
      revision(r.applied_revision, 0) &&
      (v.state === 'applied'
        ? r.applied_revision === r.revision && r.error_code === undefined
        : ['invalid_settings', 'stale_revision', 'revision_conflict', 'persist_failed'].includes(
            String(r.error_code),
          ))
    )
      return v as TelemetrySettingsStatus;
  }
  throw new ApiError('监控设置确认状态无效，请重新读取。', 'invalid-response');
}
function settings(v: unknown): TelemetrySettings {
  if (!isTelemetrySettings(v))
    throw new ApiError('监控设置格式无效，请重新读取。', 'invalid-response');
  return v;
}
export async function getTelemetrySettings(id: string, signal?: AbortSignal) {
  const value = await apiRequest<unknown>(`/nodes/${encodeURIComponent(id)}/telemetry-settings`, {
    signal,
  });
  return parseTelemetrySettingsResponse(value);
}
export function parseTelemetrySettingsResponse(value: unknown) {
  const { status: confirmation, ...raw } = value as Record<string, unknown>;
  const desired = settings(raw);
  return { desired, status: parseTelemetrySettingsStatus(confirmation) };
}
export async function getTelemetrySettingsStatus(id: string, signal?: AbortSignal) {
  return parseTelemetrySettingsStatus(
    await apiRequest(`/nodes/${encodeURIComponent(id)}/telemetry-settings/status`, { signal }),
  );
}
export async function saveTelemetrySettings(
  session: Session,
  id: string,
  next: TelemetrySettings,
  signal?: AbortSignal,
) {
  settings(next);
  return settings(
    await apiRequest(`/nodes/${encodeURIComponent(id)}/telemetry-settings`, {
      method: 'PUT',
      csrfToken: session.csrf_token,
      json: next,
      signal,
    }),
  );
}
export function telemetrySettingsState(
  desired: TelemetrySettings | undefined,
  status: TelemetrySettingsStatus | undefined,
) {
  if (!desired || !status) return 'unknown';
  return status.result?.revision === desired.revision ? status.state : 'pending';
}
