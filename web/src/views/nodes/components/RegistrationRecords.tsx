import { RefreshCw, Server } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { nodeState } from '@/api/nodes';
import { listRegistrationRecords, REGISTRATION_PAGE_SIZE } from '@/api/registration';
import { Badge, type BadgeTone } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';
import DataTable from '@/components/data-table';
import EmptyStates from '@/components/empty-states';
import InitialSkeleton from '@/components/initial-skeleton';
import Pagination from '@/components/pagination';
import { cursorListPageSizes, useCursorList } from '@/hooks/use-cursor-list';

function recordStateTone(state: string): BadgeTone {
  if (state === 'online') return 'success';
  if (state === 'offline') return 'danger';
  if (state === 'pending') return 'warning';
  return 'neutral';
}

export default function RegistrationRecords({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const fetchItems = useCallback(
    (after: string, signal: AbortSignal, limit: number) =>
      listRegistrationRecords(id, after, signal, limit),
    [id],
  );
  const list = useCursorList({
    enabled: open,
    fetchItems,
    defaultPageSize: REGISTRATION_PAGE_SIZE,
    errorMessage: '无法读取注册记录，请重试。',
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) list.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary" aria-label={`查看 ${name} 的已注册节点`}>
          <Server size={15} aria-hidden="true" />
          已注册节点
        </Button>
      </DialogTrigger>
      <DialogContent
        title="注册节点"
        description={name}
        className="[--dialog-width:min(760px,calc(100vw-2rem))]"
      >
        <div className="space-y-4">
          <div className="hidden sm:block">
            <DataTable
              rows={list.items}
              loaded={list.loaded}
              loading={list.loading}
              error={list.error}
              onRetry={list.retry}
              rowKey="id"
              caption="注册节点"
              emptyMessage="尚无注册节点"
              columns={[
                {
                  sortable: false,
                  key: 'name',
                  label: '节点名称',
                  render: (_, row) =>
                    row.node_id ? (
                      <Link className="wrap-anywhere underline" to={`/nodes/${row.node_id}`}>
                        {row.name}
                      </Link>
                    ) : (
                      '节点已删除'
                    ),
                },
                {
                  sortable: false,
                  key: 'state',
                  label: '状态',
                  render: (value) => (value === 'deleted' ? '已删除' : nodeState(String(value))),
                },
                {
                  sortable: false,
                  key: 'created_at',
                  label: '注册时间',
                  render: (value) => new Date(String(value)).toLocaleString('zh-CN'),
                },
              ]}
            />
          </div>

          <div className="sm:hidden">
            {!list.loaded && list.loading ? (
              <InitialSkeleton lines={3} label="正在读取注册记录" />
            ) : !list.loaded ? (
              <EmptyStates
                headingLevel={3}
                compact
                variant="unknown"
                title="注册记录尚未读取"
                action={
                  list.error ? (
                    <Button variant="secondary" onClick={list.retry}>
                      <RefreshCw size={15} aria-hidden="true" />
                      重新读取
                    </Button>
                  ) : undefined
                }
              />
            ) : list.items.length === 0 ? (
              <EmptyStates headingLevel={3} compact variant="empty" title="尚无注册节点" />
            ) : (
              <ul aria-label="注册节点" className="space-y-2.5">
                {list.items.map((row) => (
                  <li
                    key={row.id}
                    className="space-y-1.5 rounded-(--radius-control) border-[1px] border-border bg-background p-3 text-(length:--text-xs)"
                  >
                    <div className="flex items-center justify-between gap-2">
                      {row.node_id ? (
                        <Link
                          className="min-w-0 font-medium text-foreground underline wrap-anywhere"
                          to={`/nodes/${row.node_id}`}
                        >
                          {row.name}
                        </Link>
                      ) : (
                        <span className="text-text-secondary">节点已删除</span>
                      )}
                      <Badge size="sm" tone={recordStateTone(row.state)}>
                        {row.state === 'deleted' ? '已删除' : nodeState(row.state)}
                      </Badge>
                    </div>
                    <p className="text-text-secondary tabular-nums">
                      注册于 {new Date(row.created_at).toLocaleString('zh-CN')}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              loading={list.loading}
              variant="secondary"
              disabled={list.loading}
              onClick={() => void list.refresh()}
            >
              <RefreshCw size={16} aria-hidden="true" />
              刷新记录
            </Button>
            {list.loaded && (
              <Pagination
                label="注册节点分页"
                page={list.page}
                hasNext={list.hasNext}
                busy={list.loading}
                onPageChange={list.goToPage}
                pageSize={{
                  value: list.pageSize,
                  options: cursorListPageSizes,
                  onChange: list.changePageSize,
                }}
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
