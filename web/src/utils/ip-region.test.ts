import { expect, it } from 'vitest';
import { sessionRegion } from './ip-region';

it.each([
  ['US', '美国'],
  ['CN / 浙江 / 杭州', '中国杭州'],
  ['CN / 浙江', '中国浙江'],
  ['SG / 新加坡', '新加坡'],
  ['内网 / 非公网地址', '内网 / 非公网地址'],
  ['未记录', '未记录'],
  ['归属地未知', '地区未知'],
  [undefined, '地区未知'],
])('formats the recorded session location %s', (location, expected) => {
  expect(sessionRegion(location)).toBe(expected);
});
