import { expect, it } from 'vitest';
import type { TaskRecord } from '@/api/tasks';
import { taskDuration, taskFinished, taskNote } from './task-display';

const task = {
  state: 'queued',
  created_at: '2026-10-31T00:00:00Z',
  updated_at: '2026-10-31T00:01:05Z',
  error_code: '',
} as TaskRecord;
it('does not confuse dispatch or acknowledgement with completion', () => {
  for (const state of ['queued', 'dispatched', 'accepted', 'running']) {
    expect(taskFinished({ ...task, state })).toBe(false);
    expect(taskDuration({ ...task, state })).toBe('尚未结束');
  }
  expect(taskDuration({ ...task, state: 'succeeded' })).toBe('1 分 5 秒');
  expect(taskNote({ ...task, state: 'accepted' })).toContain('等待最终结果');
});
it('explains scheduler expiry without inventing an Agent failure', () => {
  expect(taskNote({ ...task, state: 'failed', error_code: 'deadline_exceeded' })).toContain(
    '截止时间',
  );
  expect(taskNote({ ...task, state: 'failed', error_code: 'unknown' })).toContain('查看详情');
  expect(taskFinished({ ...task, state: 'cancelled' })).toBe(true);
});
