import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { TelemetrySnapshot } from '@/api/telemetry';
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
