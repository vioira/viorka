import { expect, it } from 'vitest';
import { bytes, isMonitoringSnapshot, isStale, newerMonitoring } from './monitoring';

const snapshot = { received_at: '2026-11-03T00:00:00Z', stale: true, history: [] };
it('keeps missing telemetry unknown and rejects retired payloads', () => {
  expect(isMonitoringSnapshot(snapshot)).toBe(true);
  expect(isStale(snapshot, Date.parse(snapshot.received_at))).toBe(true);
  expect(isMonitoringSnapshot({ ...snapshot, latest: {} })).toBe(false);
  expect(isMonitoringSnapshot({ ...snapshot, telemetry: {} })).toBe(false);
  expect(isMonitoringSnapshot({ ...snapshot, history: null })).toBe(false);
  expect(bytes(0)).toBe('0 B');
  expect(bytes(undefined)).toBe('未知');
});
it('allows a newer REST refresh to supersede disconnected SSE', () => {
  const newer = { ...snapshot, received_at: '2026-11-03T00:01:00Z' };
  expect(newerMonitoring(snapshot, newer)).toBe(newer);
  expect(newerMonitoring(newer, snapshot)).toBe(newer);
});
