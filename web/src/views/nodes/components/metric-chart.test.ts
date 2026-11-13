import { expect, it } from 'vitest';
import { bitsPerSecond, metricCharts } from './metric-chart';

it('converts byte rates to decimal bit rates and leaves unknown values unknown', () => {
  expect(bitsPerSecond(125000)).toBe('1 Mbps');
  expect(bitsPerSecond(0)).toBe('0 bps');
  expect(bitsPerSecond()).toBe('未知');
  expect(metricCharts().find((chart) => chart.key === 'network')?.value).toBe('未知 / 未知');
});
