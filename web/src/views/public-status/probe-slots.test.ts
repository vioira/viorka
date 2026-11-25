import { expect, it } from 'vitest';
import { statusProbeSlots } from './probe-slots';

it('shows the latest sample in each ended three-minute interval and leaves empty intervals blank', () => {
  const sample = (time: string) => ({ at: `2026-11-24T${time}+08:00`, ping: -1, loss: 100 });
  const last = sample('19:40:37');
  const line = {
    slot: 1,
    name: '浙江电信',
    latest: sample('19:42:37'),
    history: [last, sample('19:36:37'), sample('19:39:37')],
  };
  const slots = statusProbeSlots(line, Date.parse(line.latest.at));
  const live = statusProbeSlots(line, Date.parse(line.latest.at), true);
  expect(live).toHaveLength(20);
  expect(live.at(-1)).toEqual({
    start: Date.parse(sample('19:42:00').at) / 1000,
    end: Date.parse(line.latest.at) / 1000,
    point: line.latest,
  });
  expect(slots).toHaveLength(20);
  expect(slots.at(-3)?.point).toBeUndefined();
  expect(slots.at(-2)?.point).toEqual(sample('19:36:37'));
  expect(slots.at(-1)).toEqual({
    start: Date.parse(sample('19:39:00').at) / 1000,
    end: Date.parse(sample('19:42:00').at) / 1000,
    point: last,
  });
});

it('reveals the 17:06 block at 17:09 while retaining the latest reading during the interval', () => {
  const at = (time: string) => Date.parse(`2026-11-25T${time}+08:00`);
  const latest = { at: '2026-11-25T17:06:00+08:00', ping: 28, loss: 0 };
  const line = { slot: 1, name: '线路 1', latest, history: [] };
  for (const time of ['17:06:00', '17:06:30', '17:08:59.999']) {
    expect(statusProbeSlots(line, at(time)).at(-1)?.end).toBe(at('17:06:00') / 1000);
  }
  expect(statusProbeSlots(line, at('17:09:00')).at(-1)).toEqual({
    start: at('17:06:00') / 1000,
    end: at('17:09:00') / 1000,
    point: latest,
  });
});
