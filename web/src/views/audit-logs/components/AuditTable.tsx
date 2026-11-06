import { Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AuditRecord } from '@/api/audit';
import { Button } from '@/components/arc/button/button';
import { Drawer, DrawerContent } from '@/components/arc/drawer/drawer';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import DataTable, { type DataColumn } from '@/components/data-table';

function LocalTime({ value }: { value: string }) {
  const [label, setLabel] = useState(value);
  useEffect(() => {
    setLabel(new Date(value).toLocaleString('zh-CN', { hour12: false }));
  }, [value]);
  return (
    <time dateTime={value} className="tabular-nums" title={value}>
      {label}
    </time>
  );
}

export default function AuditTable({
  records,
  error,
  emptyMessage,
  onRetry,
}: {
  records: AuditRecord[];
  error: string;
  emptyMessage: string;
  onRetry: () => void;
}) {
  const [selected, setSelected] = useState<AuditRecord | null>(null);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const { toast } = useToastStack();
  async function copyRecord() {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(
        [
          `记录 ID：${selected.id}`,
          `类型：${selected.kind === 'user' ? '用户操作' : '系统事件'}`,
          `操作：${selected.action}`,
          `操作者：${selected.actor}`,
          `对象：${selected.target || '未记录'}`,
          `来源 IP：${selected.ip}`,
          `时间（UTC）：${selected.time}`,
        ].join('\n'),
      );
      toast({ id: 'audit-copy', type: 'success', title: '已复制审计记录' });
    } catch {
      toast({
        id: 'audit-copy',
        type: 'error',
        title: '复制失败',
        description: '请在详情中选择文本手动复制。',
      });
    }
  }
  const columns: DataColumn<AuditRecord>[] = [
    {
      key: 'time',
      label: '时间',
      width: 192,
      render: (_, row) => (
        <span className="whitespace-nowrap text-text-secondary">
          <LocalTime value={row.time} />
        </span>
      ),
    },
    {
      key: 'action',
      label: '操作',
      width: 208,
      render: (_, row) => (
        <div className="min-w-0 flex items-center">
          <p className="max-w-48 truncate font-medium" title={row.action}>
            {row.action}
          </p>
          <span className="mx-1">/</span>
          <p className="text-(length:--text-xs) text-text-secondary">
            {row.kind === 'user' ? '用户操作' : '系统事件'}
          </p>
        </div>
      ),
    },
    {
      key: 'actor',
      label: '操作者',
      width: 160,
      render: (_, row) => (
        <span className="block max-w-36 truncate" title={row.actor}>
          {row.actor}
        </span>
      ),
    },
    {
      key: 'target',
      label: '对象',
      width: 240,
      render: (_, row) => (
        <span className="block max-w-56 truncate text-text-secondary" title={row.target}>
          {row.target || '未记录'}
        </span>
      ),
    },
    {
      key: 'ip',
      label: '来源 IP',
      width: 160,
      render: (_, row) => (
        <span className="block max-w-36 truncate font-mono text-text-secondary" title={row.ip}>
          {row.ip}
        </span>
      ),
    },
    {
      key: 'details',
      label: '详情',
      width: 104,
      sortable: false,
      render: (_, row) => (
        <Button
          variant="ghost"
          aria-label={`查看审计记录：${row.action}，${row.actor}`}
          onClick={(event) => {
            trigger.current = event.currentTarget;
            setSelected(row);
            setOpen(true);
          }}
        >
          查看详情
        </Button>
      ),
    },
  ];
  return (
    <>
      <DataTable
        rows={records}
        columns={columns}
        rowKey="id"
        defaultSort={{ key: 'time', direction: 'desc' }}
        caption="审计日志"
        error={error}
        onRetry={onRetry}
        emptyMessage={emptyMessage}
      />
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent
          title="审计记录详情"
          description="操作记录用于追溯，不代表异步任务已执行成功。"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          {selected && (
            <div className="space-y-6">
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-4">
                {[
                  ['记录 ID', selected.id],
                  ['类型', selected.kind === 'user' ? '用户操作' : '系统事件'],
                  ['操作', selected.action],
                  ['操作者', selected.actor],
                  ['对象', selected.target || '未记录'],
                  ['来源 IP', selected.ip],
                ].map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="text-text-secondary">{label}</dt>
                    <dd className="min-w-0 select-text whitespace-pre-wrap wrap-anywhere">
                      {value}
                    </dd>
                  </div>
                ))}
                <dt className="text-text-secondary">本地时间</dt>
                <dd className="wrap-anywhere">
                  <LocalTime value={selected.time} />
                </dd>
                <dt className="text-text-secondary">UTC 时间</dt>
                <dd className="select-text wrap-anywhere font-mono">{selected.time}</dd>
              </dl>
              <Button variant="secondary" onClick={copyRecord}>
                <Copy size={16} aria-hidden="true" />
                复制审计记录
              </Button>
            </div>
          )}
        </DrawerContent>
      </Drawer>
    </>
  );
}
