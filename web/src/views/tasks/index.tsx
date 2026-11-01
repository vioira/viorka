import { RefreshCw } from 'lucide-react';
import { useRef, useState } from 'react';
import { useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import { taskFilters } from '@/api/tasks';
import { Button } from '@/components/arc/button/button';
import { Drawer, DrawerContent } from '@/components/arc/drawer/drawer';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import TaskDetails from './components/TaskDetails';
import TaskMetrics from './components/TaskMetrics';
import TaskTable from './components/TaskTable';
import { useTasks } from './use-tasks';

export default function TasksPage() {
  const session = useOutletContext<Session>();
  const tasks = useTasks();
  const [selected, setSelected] = useState('');
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-title text-(length:--text-2xl) font-medium">任务中心</h1>
          <p className="mt-2 max-w-prose text-text-secondary">
            任务先持久化再派发。同一节点按幂等键去重，提交与接收均不代表执行成功。
          </p>
        </div>
        <Button variant="secondary" disabled={tasks.loading} onClick={tasks.refresh}>
          <RefreshCw size={16} aria-hidden="true" />
          刷新任务
        </Button>
      </div>
      <TaskMetrics summary={tasks.summary} />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <fieldset
          disabled={tasks.loading}
          className="min-w-0 max-w-full overflow-x-auto disabled:opacity-50"
        >
          <SegmentedControl
            label="筛选任务状态"
            options={taskFilters}
            value={tasks.view.state}
            onValueChange={tasks.filter}
          />
        </fieldset>
        <p role="status" className="text-(length:--text-xs) text-text-secondary tabular-nums">
          {tasks.loading
            ? '正在读取任务…'
            : tasks.stale
              ? '尚未同步最新状态'
              : tasks.loaded
                ? `当前页 ${tasks.page.items.length} 条，状态变更后自动更新`
                : '任务尚未读取'}
        </p>
      </div>
      <TaskTable
        items={tasks.page.items}
        loading={tasks.loading}
        loaded={tasks.loaded}
        state={tasks.view.state}
        onOpen={(id, element) => {
          trigger.current = element;
          setSelected(id);
          setOpen(true);
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          disabled={tasks.loading || !tasks.loaded || !tasks.view.history.length}
          onClick={tasks.previous}
        >
          上一页
        </Button>
        <Button
          variant="secondary"
          disabled={tasks.loading || !tasks.loaded || !tasks.page.next_cursor}
          onClick={tasks.next}
        >
          下一页
        </Button>
        {tasks.view.state !== 'all' && (
          <Button variant="ghost" disabled={tasks.loading} onClick={() => tasks.filter('all')}>
            查看全部任务
          </Button>
        )}
      </div>
      <p className="text-(length:--text-xs) text-text-secondary">
        每页最多 50
        条，默认按创建时间倒序；表头排序仅作用于当前页。总耗时包含排队与重投等待，时间按浏览器时区显示。
      </p>
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent
          title="任务详情"
          description="查看真实派发状态与 Agent 回报。"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          {selected && (
            <TaskDetails
              key={selected}
              id={selected}
              session={session}
              onCreated={(id) => {
                setSelected(id);
                tasks.refresh();
              }}
            />
          )}
        </DrawerContent>
      </Drawer>
    </>
  );
}
