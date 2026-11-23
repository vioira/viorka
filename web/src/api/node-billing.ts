import type { Session } from './auth';
import { ApiError, apiRequest } from './client';

export const billingPeriods = {
  1: '月',
  3: '季',
  6: '半年',
  24: '两年',
  36: '三年',
  48: '四年',
  60: '五年',
} as const;
export const billingCurrencies = ['CNY', 'USD', 'EUR', 'JPY'] as const;
export type NodeBilling = {
  revision: number;
  price?: string;
  currency?: (typeof billingCurrencies)[number];
  period_months?: keyof typeof billingPeriods;
  expires_at?: string;
};

export function isNodeBilling(value: unknown): value is NodeBilling {
  if (!value || typeof value !== 'object') return false;
  const b = value as NodeBilling;
  if (
    !Number.isSafeInteger(b.revision) ||
    b.revision < 1 ||
    (b.expires_at !== undefined &&
      (typeof b.expires_at !== 'string' || !Number.isFinite(Date.parse(b.expires_at))))
  )
    return false;
  if (b.price === undefined) return b.currency === undefined && b.period_months === undefined;
  return (
    typeof b.price === 'string' &&
    typeof b.period_months === 'number' &&
    Object.hasOwn(billingPeriods, b.period_months) &&
    !!b.currency &&
    billingCurrencies.includes(b.currency) &&
    (b.currency === 'JPY' ? /^\d+$/ : /^\d+(\.\d{1,2})?$/).test(b.price)
  );
}

export async function saveNodeBilling(
  id: string,
  update: Omit<NodeBilling, 'revision'> & { expected_revision: number },
  session: Session,
  signal?: AbortSignal,
) {
  const result = await apiRequest<unknown>(`/nodes/${encodeURIComponent(id)}/billing`, {
    method: 'PUT',
    csrfToken: session.csrf_token,
    json: update,
    signal,
  });
  if (!isNodeBilling(result))
    throw new ApiError('费用配置响应无效，请重新读取。', 'invalid-response');
  return result;
}
