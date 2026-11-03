import { expect, it } from 'vitest';
import { billableTraffic, defaultTrafficSettings, gibToBytes, isTrafficSettings } from './traffic';

it('defaults to both directions and supports outbound-only billing without inbound data', () => {
  expect(defaultTrafficSettings.billing_mode).toBe('both');
  expect(billableTraffic('100', '250', 'both')).toBe(350n);
  expect(billableTraffic(undefined, '250', 'outbound')).toBe(250n);
  expect(billableTraffic(undefined, '250', 'both')).toBeUndefined();
});
it('keeps exact bytes and validates input', () => {
  expect(gibToBytes('1.5')).toBe('1610612736');
  expect(() => gibToBytes('-1')).toThrow();
  expect(() => gibToBytes('999999999999999')).toThrow();
  expect(isTrafficSettings({ ...defaultTrafficSettings, interfaces: 'eth0,eth1' })).toBe(true);
  expect(isTrafficSettings({ ...defaultTrafficSettings, interfaces: 'eth0,eth0' })).toBe(false);
  expect(isTrafficSettings({ ...defaultTrafficSettings, timezone: 'invalid' })).toBe(false);
});
