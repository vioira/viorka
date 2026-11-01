import type { TaskRecord } from '@/api/tasks';

export function taskFinished(task: TaskRecord) {
  return ['succeeded', 'failed', 'cancelled', 'rolled_back'].includes(task.state);
}
export function taskDuration(task: TaskRecord) {
  if (!taskFinished(task)) return '尚未结束';
  const seconds = Math.max(0, (Date.parse(task.updated_at) - Date.parse(task.created_at)) / 1000);
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分 ${Math.floor(seconds % 60)} 秒`;
  return `${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分`;
}
export function taskNote(task: TaskRecord) {
  if (task.state === 'failed') {
    return (
      (
        {
          inspection_failed: '节点检查失败，可重新提交只读检查',
          deadline_exceeded: '任务已超过截止时间，请检查节点连接',
          deadline_or_attempts_exhausted: '任务超时或已达到投递上限，请检查节点连接',
        } as Record<string, string>
      )[task.error_code] ?? '任务失败，请查看详情并检查节点状态'
    );
  }
  return (
    (
      {
        queued: '等待节点连接并领取任务',
        dispatched: '已通过管理连接派发，等待 Agent 确认',
        accepted: 'Agent 已接收，等待最终结果',
        running: 'Agent 正在执行，等待最终结果',
        succeeded: 'Agent 已回报执行成功',
        cancelled: '任务已取消',
        rolled_back: '任务已回滚',
      } as Record<string, string>
    )[task.state] ?? '未知任务状态，请刷新任务'
  );
}
