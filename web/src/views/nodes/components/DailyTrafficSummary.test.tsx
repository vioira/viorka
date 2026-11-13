import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { DailyTraffic, TelemetrySnapshot } from '@/api/telemetry';
import { nodeDailyTraffic } from '@/components/node-inventory';
import type { ListedNode } from '@/hooks/use-nodes';
import DailyTrafficSummary from './DailyTrafficSummary';

const now = Date.parse('2026-11-13T12:00:00Z');
const telemetry = {
  settings: { traffic: { billing_mode: 'both' }, http_report_seconds: 60, collection_seconds: 5 },
  daily_traffic: {
    day_start: '2026-11-13T00:00:00Z',
    day_end: '2026-11-14T00:00:00Z',
    sampled_at: '2026-11-13T12:00:00Z',
    rx_bytes: '8000000000',
    tx_bytes: '2000000000',
    quality: 1,
    revision: 2,
  },
} as TelemetrySnapshot;

it('shows persisted daily counters and billing mode', () => {
  const html = renderToStaticMarkup(
    <DailyTrafficSummary telemetry={telemetry} now={now} stale={false} />,
  );
  expect(html).toContain('10.0 GB');
  expect(html).toContain('今日数据不完整');
  expect(html).toContain('已更新');
});
it('retains stale values and clears them at the next day boundary', () => {
  expect(
    renderToStaticMarkup(<DailyTrafficSummary telemetry={telemetry} now={now} stale />),
  ).toContain('数据已过期');
  const html = renderToStaticMarkup(
    <DailyTrafficSummary telemetry={telemetry} now={Date.parse('2026-11-14T00:00:00Z')} stale />,
  );
  expect(html).toContain('等待今日采样');
  expect(html).not.toContain('10.0 GB');
  expect(html.match(/未知/g)).toHaveLength(3);
});

it('shows list daily billing, keeps stale totals and clears yesterday', () => {
  const node = { state: 'online', monitoring: { telemetry } } as ListedNode;
  expect(nodeDailyTraffic(node, now)).toMatchObject({
    traffic: 10,
    trafficLabel: '10.0 GB',
    trafficNote: '数据不完整',
  });
  const live = {
    ...node,
    metricSummary: {
      received_at: '',
      expires_at: '',
      cpu: null,
      memory: null,
      daily_traffic: { ...(telemetry.daily_traffic as DailyTraffic), tx_bytes: '0', quality: 0 },
      traffic_billing_mode: 'outbound' as const,
      traffic_expires_at: '2026-11-13T12:02:00Z',
    },
  };
  expect(nodeDailyTraffic(live, now)).toMatchObject({
    traffic: 0,
    trafficLabel: '0 B',
    trafficNote: '',
  });
  expect(nodeDailyTraffic({ ...node, state: 'offline' }, now)).toMatchObject({
    traffic: 10,
    trafficNote: '数据已过期，数据不完整',
  });
  expect(nodeDailyTraffic(node, Date.parse('2026-11-14T00:00:00Z')).traffic).toBeNull();
});
