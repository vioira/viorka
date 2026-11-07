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
export function taskNote(task: Pick<TaskRecord, 'state' | 'error_code'>) {
  if (task.state === 'failed') {
    return (
      (
        {
          inspection_failed: '节点检查失败，可重新提交只读检查',
          engine_unsupported: '当前系统或引擎版本不支持此操作，请检查 Agent 和版本清单',
          engine_external: '发现同类第三方实例或归属不一致，请先人工核对，不能自动接管',
          engine_download_failed: '官方制品下载失败，请检查节点网络后重试安装',
          engine_checksum: '制品摘要不匹配，未安装该文件，请核对官方发行清单',
          engine_invalid_config: '配置预检未通过，请检查服务字段、自循环和依赖',
          engine_target_unreachable:
            '目标预检失败，请检查 DNS、目标端口和 TLS；Realm 可明确确认暂不可达风险',
          engine_port_conflict: '本地监听端口被占用，请调整草稿或处理占用进程',
          engine_start_failed: '引擎启动或健康检查失败，已尝试恢复旧状态，请核对节点',
          engine_rollback_failed: '恢复旧状态失败，引擎已标记异常，需要人工处理',
          engine_io_failed: '节点文件或系统服务操作失败，请检查权限和磁盘状态',
          engine_result_unknown: '执行结果未知，禁止盲目重试，请先核对引擎实际状态',

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
