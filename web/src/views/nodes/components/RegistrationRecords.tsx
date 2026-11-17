import { RefreshCw, Server } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { nodeState } from '@/api/nodes';
import {
  listRegistrationRecords,
  REGISTRATION_PAGE_SIZE,
  type RegistrationRecord,
} from '@/api/registration';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';
import DataTable from '@/components/data-table';
import { useToastFeedback } from '@/hooks/use-toast-feedback';

export default function RegistrationRecords({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [after, setAfter] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [rows, setRows] = useState<RegistrationRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [, error] = useToastFeedback('error');
  useEffect(() => {
    if (!open) return;
    void attempt;
    const controller = new AbortController();
    setLoading(true);
    listRegistrationRecords(id, after, controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) {
          setRows(items);
          setLoaded(true);
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          error(cause instanceof Error ? cause.message : '无法读取注册记录，请重试。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, after, open, attempt, error]);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) {
          setAfter('');
          setRows([]);
          setLoaded(false);
        }
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
          {rows.length > 0 && (
            <ul aria-label="注册节点" className="divide-y divide-border-subtle sm:hidden">
              {rows.map((row) => (
                <li key={row.id} className="space-y-2 py-4 first:pt-0">
                  {row.node_id ? (
                    <Link className="wrap-anywhere underline" to={`/nodes/${row.node_id}`}>
                      {row.name}
                    </Link>
                  ) : (
                    <p>节点已删除</p>
                  )}
                  <p className="text-text-secondary">
                    {row.state === 'deleted' ? '已删除' : nodeState(row.state)}
                  </p>
                  <p className="text-(length:--text-sm) text-text-secondary tabular-nums">
                    注册于 {new Date(row.created_at).toLocaleString('zh-CN')}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <div className={rows.length > 0 ? 'hidden sm:block' : undefined}>
            <DataTable
              rows={rows}
              loaded={loaded}
              loading={loading}
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
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              loading={loading}
              variant="secondary"
              disabled={loading}
              onClick={() => setAttempt((value) => value + 1)}
            >
              <RefreshCw size={16} aria-hidden="true" />
              刷新记录
            </Button>
            <Button
              variant="secondary"
              disabled={loading || !after}
              onClick={() => {
                setAfter('');
              }}
            >
              返回首页
            </Button>
            <Button
              variant="secondary"
              disabled={loading || !loaded || rows.length < REGISTRATION_PAGE_SIZE}
              onClick={() => {
                setAfter(rows.at(-1)?.id ?? '');
              }}
            >
              下一页
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
