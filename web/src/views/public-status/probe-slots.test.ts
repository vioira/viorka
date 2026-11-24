import { expect, it } from 'vitest';
import { statusProbeSlots } from './probe-slots';

it('shows only ended three-minute intervals with observations in all three minutes', () => {
  const sample = (time: string) => ({ at: `2026-11-24T${time}+08:00`, ping: -1, loss: 100 });
  const last = sample('19:41:37');
  const line = {
    slot: 1,
    name: '浙江电信',
    latest: sample('19:42:37'),
    history: ['19:36:37', '19:38:00', '19:38:37', '19:39:37', '19:40:37'].map(sample).concat(last),
  };
  const slots = statusProbeSlots(line, Date.parse(line.latest.at));
  expect(slots).toHaveLength(20);
  expect(slots.at(-2)?.point).toBeUndefined();
  expect(slots.at(-1)).toEqual({
    start: Date.parse(sample('19:39:00').at) / 1000,
    end: Date.parse(sample('19:42:00').at) / 1000,
    point: last,
  });
});
