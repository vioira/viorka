import { type DailyTraffic, isDailyTraffic } from './telemetry';
export type MetricSummary = {
  daily_traffic?: DailyTraffic | null;
  traffic_billing_mode?: '' | 'both' | 'inbound' | 'outbound';
  traffic_expires_at?: string | null;
  received_at: string;
  expires_at: string;
  cpu: number | null;
  memory: number | null;
};
export type MetricSummaryFrame = {
  reset: boolean;
  items: Record<string, MetricSummary>;
  removed_ids: string[];
};
export function parseMetricSummaryFrame(raw: string): MetricSummaryFrame {
  const frame = JSON.parse(raw) as MetricSummaryFrame;
  const date = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
  const percent = (v: unknown) =>
    v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100);
  if (
    !frame ||
    typeof frame.reset !== 'boolean' ||
    !frame.items ||
    typeof frame.items !== 'object' ||
    Array.isArray(frame.items) ||
    Object.keys(frame.items).length > 1024 ||
    !Array.isArray(frame.removed_ids) ||
    !frame.removed_ids.every((id) => typeof id === 'string') ||
    !Object.values(frame.items).every(
      (s) =>
        s &&
        date(s.received_at) &&
        date(s.expires_at) &&
        percent(s.cpu) &&
        percent(s.memory) &&
        (s.daily_traffic == null || isDailyTraffic(s.daily_traffic)) &&
        (s.traffic_billing_mode === undefined ||
          ['', 'both', 'inbound', 'outbound'].includes(s.traffic_billing_mode)) &&
        (s.traffic_expires_at == null || date(s.traffic_expires_at)),
    )
  )
    throw new Error('节点指标摘要格式无效');
  return frame;
}
export function mergeMetricSummaryFrame(
  current: Record<string, MetricSummary>,
  frame: MetricSummaryFrame,
) {
  const next = frame.reset ? ({} as Record<string, MetricSummary>) : { ...current };
  for (const [id, sample] of Object.entries(frame.items)) next[id] = sample;
  for (const id of frame.removed_ids) delete next[id];
  return next;
}
