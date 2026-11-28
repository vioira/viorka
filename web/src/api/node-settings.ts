import type { Session } from './auth';
import { ApiError, apiRequest } from './client';
import { isNodeBilling, type NodeBilling } from './node-billing';
import { isTelemetrySettings, type TelemetrySettings } from './telemetry';

export type BillingUpdate = Omit<NodeBilling, 'revision' | 'expires_at'> & {
  expected_revision: number;
  expires_on?: string;
  time_zone?: string;
  keep_expiry?: boolean;
};
type Update = {
  domain?: string;
  expected_domain?: string;
  billing?: BillingUpdate;
  telemetry?: TelemetrySettings;
};
type Result = { domain?: string; billing?: NodeBilling; telemetry?: TelemetrySettings };

export async function saveNodeSettings(
  session: Session,
  id: string,
  update: Update,
  signal: AbortSignal,
): Promise<Result> {
  const result = await apiRequest<Result>(`/nodes/${encodeURIComponent(id)}/settings`, {
    method: 'PATCH',
    csrfToken: session.csrf_token,
    json: update,
    signal,
  });
  if (
    !result ||
    (update.domain !== undefined && typeof result.domain !== 'string') ||
    (update.billing && !isNodeBilling(result.billing)) ||
    (update.telemetry && !isTelemetrySettings(result.telemetry))
  ) {
    throw new ApiError('节点设置响应无效，请重新读取。', 'invalid-response');
  }
  return result;
}
