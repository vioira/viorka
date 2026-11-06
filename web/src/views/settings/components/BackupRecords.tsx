import { Download, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { BackupList } from '@/api/settings';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';
import DataTable from '@/components/data-table';

export default function BackupRecords({
  data,
  pending,
  error,
  onDownload,
  onDelete,
}: {
  data: BackupList | null;
  pending: boolean;
  error: string;
  onDownload: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const [deleting, setDeleting] = useState<string | null>(null);
  return (
    <section className="v-card" aria-label="备份记录">
      <h2 className="v-card-title mb-5">备份记录</h2>
      <DataTable
        rows={(data?.items ?? []).map((item) => ({ ...item }))}
        rowKey="id"
        caption="备份记录"
        loading={!data && !error}
        emptyMessage={data ? '暂无备份' : '尚未读取备份记录'}
        columns={[
          {
            key: 'id',
            label: 'ID',
            sortable: false,
            render: (_, row) => (
              <span
                title={row.id}
                className="block max-w-36 truncate font-mono text-(length:--text-xs)"
              >
                {row.id}
              </span>
            ),
          },
          {
            key: 'status',
            label: '状态',
            sortable: false,
            render: (_, row) =>
              ({ running: '执行中', succeeded: '成功', failed: '失败' })[row.status],
          },
          {
            key: 'filename',
            label: '文件名',
            sortable: false,
            render: (_, row) => (
              <span title={row.filename} className="block max-w-64 truncate">
                {row.filename}
              </span>
            ),
          },
          {
            key: 'size',
            label: '大小',
            numeric: true,
            sortable: false,
            render: (_, row) => (
              <span className="tabular-nums">
                {row.size ? `${(row.size / 1024).toFixed(1)} KB` : '—'}
              </span>
            ),
          },
          {
            key: 'expires_at',
            label: '过期时间',
            sortable: false,
            render: (_, row) => (
              <span className="tabular-nums whitespace-nowrap">
                {row.expires_at ? new Date(row.expires_at).toLocaleString() : '不限天数'}
              </span>
            ),
          },
          {
            key: 'trigger',
            label: '触发方式',
            sortable: false,
            render: (_, row) => (row.trigger === 'manual' ? '手动' : '计划'),
          },
          {
            key: 'created_at',
            label: '开始时间',
            sortable: false,
            render: (_, row) => (
              <span className="tabular-nums whitespace-nowrap">
                {new Date(row.created_at).toLocaleString()}
              </span>
            ),
          },
          {
            key: 'actions',
            label: '操作',
            sortable: false,
            render: (_, row) => (
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  className="min-h-11 min-w-11"
                  aria-label={`下载备份 ${row.id}`}
                  title="下载备份"
                  disabled={pending || row.status !== 'succeeded'}
                  onClick={() => onDownload(row.id)}
                >
                  <Download size={16} aria-hidden="true" />
                </Button>
                <Dialog
                  open={deleting === row.id}
                  onOpenChange={(open) => {
                    if (!pending) setDeleting(open ? row.id : null);
                  }}
                >
                  <DialogTrigger asChild>
                    <Button
                      variant="ghost"
                      className="min-h-11 min-w-11"
                      aria-label={`删除备份 ${row.id}`}
                      title="删除备份"
                      disabled={
                        pending || row.status === 'running' || row.id === data?.pending_restore
                      }
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent
                    title="删除备份？"
                    description={`将删除 ${row.filename} 的本地文件和 S3 副本（如有），无法撤销。`}
                  >
                    <div className="flex gap-3">
                      <DialogClose asChild>
                        <Button variant="secondary" disabled={pending}>
                          取消
                        </Button>
                      </DialogClose>
                      <Button
                        variant="danger"
                        loading={pending}
                        disabled={pending}
                        onClick={async () => {
                          if (await onDelete(row.id)) setDeleting(null);
                        }}
                      >
                        删除备份
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            ),
          },
        ]}
      />
    </section>
  );
}
