import { Eye, RefreshCw } from 'lucide-react';
import { useRef } from 'react';
import { useOutletContext, useSearchParams } from 'react-router';
import type { Session } from '@/api/auth';
import { taskFilters } from '@/api/tasks';
import { Button } from '@/components/arc/button/button';
import { Drawer, DrawerContent } from '@/components/arc/drawer/drawer';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import Pagination from '@/components/pagination';
import TaskDetails from './components/TaskDetails';
import TaskMetrics from './components/TaskMetrics';
import TaskTable from './components/TaskTable';
import { useTasks } from './use-tasks';

export default function TasksPage() {
  const session = useOutletContext<Session>();
  const tasks = useTasks();
  const [params, setParams] = useSearchParams();
  const selected = params.get('task') ?? '';
  const open = !!selected;
  function setSelected(id: string) {
    const next = new URLSearchParams(params);
    if (id) next.set('task', id);
    else next.delete('task');
    setParams(next, { replace: true });
  }

  const trigger = useRef<HTMLButtonElement | null>(null);

  return (
    <>
      <TaskMetrics summary={tasks.summary} />
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
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
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <Button
              loading={tasks.loading}
              variant="secondary"
              disabled={tasks.loading}
              onClick={tasks.refresh}
            >
              <RefreshCw size={16} aria-hidden="true" />
              刷新任务
            </Button>
          </div>
        </div>
        {tasks.loaded && tasks.stale && (
          <p role="status" className="text-(length:--text-xs) text-text-secondary">
            尚未同步最新状态
          </p>
        )}
      </div>
      <TaskTable
        items={tasks.page.items}
        loading={tasks.loading}
        loaded={tasks.loaded}
        state={tasks.view.state}
        onClearFilter={() => tasks.filter('all')}
        onOpen={(id, element) => {
          trigger.current = element;
          setSelected(id);
        }}
      />
      <div className="flex flex-wrap items-center justify-end gap-3">
        {tasks.view.state !== 'all' && (
          <Button variant="secondary" disabled={tasks.loading} onClick={() => tasks.filter('all')}>
            <Eye size={16} aria-hidden="true" />
            查看全部任务
          </Button>
        )}
        {tasks.loaded && (
          <Pagination
            label="任务分页"
            page={tasks.view.history.length + 1}
            hasNext={!!tasks.page.next_cursor}
            busy={tasks.loading}
            onPageChange={tasks.goToPage}
          />
        )}
      </div>
      <Drawer
        open={open}
        onOpenChange={(v) => {
          if (!v) setSelected('');
        }}
      >
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
