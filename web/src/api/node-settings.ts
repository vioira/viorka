import type { Session } from './auth';
import { ApiError, apiRequest } from './client';

export type NodeSettings = {
  revision: number;
  collection_seconds: number;
  report_seconds: number;
  connection_mode: 'wss';
  wss_report_seconds: number;
};
function readSettings(value: unknown): NodeSettings {
  const s = value as NodeSettings | null;
  if (
    !s ||
    !Number.isSafeInteger(s.revision) ||
    s.revision < 1 ||
    s.connection_mode !== 'wss' ||
    !Number.isInteger(s.collection_seconds) ||
    s.collection_seconds < 0 ||
    s.collection_seconds > 10 ||
    !Number.isInteger(s.report_seconds) ||
    s.report_seconds < 30 ||
    s.report_seconds > 180 ||
    !Number.isInteger(s.wss_report_seconds) ||
    s.wss_report_seconds < 1 ||
    s.wss_report_seconds > 5
  ) {
    throw new ApiError('节点设置格式无效，请重新读取。', 'invalid-response');
  }
  return s;
}
export async function getNodeSettings(id: string, signal?: AbortSignal) {
  return readSettings(
    await apiRequest<unknown>(`/nodes/${encodeURIComponent(id)}/settings`, { signal }),
  );
}
export async function saveNodeSettings(session: Session, id: string, settings: NodeSettings) {
  return readSettings(
    await apiRequest<unknown>(`/nodes/${encodeURIComponent(id)}/settings`, {
      method: 'PUT',
      csrfToken: session.csrf_token,
      json: settings,
    }),
  );
}
