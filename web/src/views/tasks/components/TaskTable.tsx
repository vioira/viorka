import { Link } from 'react-router';
import type { TaskRecord } from '@/api/tasks';
import { Button } from '@/components/arc/button/button';
import DataTable, { type DataColumn } from '@/components/data-table';
import { taskDuration, taskNote } from '../task-display';
import TaskStatus from './TaskStatus';
import TaskTime from './TaskTime';

export default function TaskTable({
  items,
  loading,
  loaded,
  state,
  onOpen,
}: {
  items: TaskRecord[];
  loading: boolean;
  loaded: boolean;
  state: string;
  onOpen: (id: string, trigger: HTMLButtonElement) => void;
}) {
  const columns: DataColumn<TaskRecord>[] = [
    {
      key: 'id',
      width: 190,
      label: '任务 ID',
      sortable: false,
      render: (_, task) => (
        <Button
          variant="ghost"
          aria-label={`查看任务 ${task.id}`}
          onClick={(event) => {
            onOpen(task.id, event.currentTarget);
          }}
        >
          <span className="max-w-28 truncate font-mono" title={task.id}>
            {task.id}
          </span>
        </Button>
      ),
    },
    {
      key: 'operation_name',
      width: 136,
      label: '类型',
      render: (_, task) => <span className="font-medium">{task.operation_name}</span>,
    },
    {
      key: 'node_name',
      width: 176,
      label: '节点',
      render: (_, task) => (
        <Link
          to={`/nodes/${encodeURIComponent(task.node_id)}`}
          className="inline-flex min-h-11 max-w-40 items-center font-medium text-accent hover:underline focus-visible:underline"
          title={`${task.node_name} (${task.node_id})`}
          aria-label={`查看节点 ${task.node_name || task.node_id} 详情`}
        >
          <span className="truncate">{task.node_name || task.node_id}</span>
        </Link>
      ),
    },
    {
      key: 'state',
      width: 112,
      label: '状态',
      render: (_, task) => <TaskStatus state={task.state} errorCode={task.error_code} />,
    },
    {
      key: 'attempt',
      width: 88,
      label: '尝试',
      render: (_, task) => (
        <span className="whitespace-nowrap text-text-secondary tabular-nums">
          {task.attempt} / {task.max_attempts}
        </span>
      ),
    },
    {
      key: 'created_at',
      width: 192,
      label: '创建时间',
      render: (_, task) => (
        <span className="whitespace-nowrap text-text-secondary">
          <TaskTime value={task.created_at} />
        </span>
      ),
    },
    {
      key: 'duration',
      width: 112,
      label: '总耗时',
      sortable: false,
      render: (_, task) => (
        <span className="whitespace-nowrap text-text-secondary tabular-nums">
          {taskDuration(task)}
        </span>
      ),
    },
    {
      key: 'note',
      width: 264,
      label: '说明',
      sortable: false,
      render: (_, task) => (
        <span className="block max-w-64 text-text-secondary">{taskNote(task)}</span>
      ),
    },
  ];
  return (
    <section aria-label="任务列表" aria-busy={loading} className="v-card">
      <DataTable
        rows={items}
        columns={columns}
        rowKey="id"
        caption="持久化任务"
        tableClassName="sm:min-w-[1270px]"
        emptyMessage={
          loaded
            ? state === 'all'
              ? '暂无任务，请在节点详情提交只读检查'
              : '当前筛选下没有任务，请查看全部任务'
            : '任务尚未读取'
        }
      />
    </section>
  );
}
