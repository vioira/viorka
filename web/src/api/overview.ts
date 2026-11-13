import { apiRequest } from './client';
import type { TaskSummary } from './tasks';

export type Overview = {
  nodes: number;
  online: number;
  offline: number;
  pending: number;
  disabled: number;
  services: number;
  synced: number;
  pending_services: number;
  failed_services: number;
  tasks: TaskSummary;
  attention: { node_id: string; title: string; detail: string; tone: string }[];
};
export type TrafficRange = 'day' | 'week' | 'month';
export type OverviewTraffic = {
  start: string;
  end: string;
  timezone: string;
  expected_nodes: number;
  rx_bytes: string | null;
  tx_bytes: string | null;
  partial: boolean;
  points: {
    date: string;
    rx_bytes: string | null;
    tx_bytes: string | null;
    reporting_nodes: number;
    partial: boolean;
    sampled_at: string;
  }[];
};
export const getOverview = (signal: AbortSignal) => apiRequest<Overview>('/overview', { signal });
export const getOverviewTraffic = (range: TrafficRange, signal: AbortSignal) =>
  apiRequest<OverviewTraffic>('/overview/traffic', {
    query: { range, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    signal,
  });
