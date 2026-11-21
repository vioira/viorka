import { RefreshCw, Server } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { nodeState } from '@/api/nodes';
import { listRegistrationRecords, REGISTRATION_PAGE_SIZE } from '@/api/registration';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';
import DataTable from '@/components/data-table';
import Pagination from '@/components/pagination';
import { cursorListPageSizes, useCursorList } from '@/hooks/use-cursor-list';

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
        <Button variant="secondary" aria-label="查看节点">
          <Server size={16} aria-hidden="true" />
          节点
        </Button>
      </DialogTrigger>
      <DialogContent title="注册节点" description={name} className="[--dialog-width:800px]">
        <div className="space-y-4">
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
