import { Download, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router';
import { type AuditRecord, listAuditLogs } from '@/api/audit';
import type { Session } from '@/api/auth';
import { Button } from '@/components/arc/button/button';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import AuditTable from './components/AuditTable';
import { auditCsv } from './export';

export default function AuditLogsPage() {
  const [filter, setFilter] = useState('all');
  const { toast } = useToastStack();
  const session = useOutletContext<Session>();
  const admin = session.user.role === 'admin';
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [after, setAfter] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState('');
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  // Commit the selected view only on success, so failed navigation retains its context.
  const [requested, setRequested] = useState({ kind: 'all', after: '', history: [] as string[] });
  useEffect(() => {
    if (!admin) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    listAuditLogs(requested.kind, requested.after, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setRecords(result.items);
        setNextCursor(result.nextCursor);
        setLoaded(true);
        setFilter(requested.kind);
        setAfter(requested.after);
        setHistory(requested.history);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : '无法读取审计日志，请重试。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [admin, requested]);
  function refresh() {
    setRequested({ kind: filter, after, history });
  }
  function exportCsv() {
    let url: string | undefined;
    try {
      url = URL.createObjectURL(new Blob([auditCsv(records)], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `viorka-audit-${filter}.csv`;
      link.click();
      toast({
        type: 'success',
        title: `已生成 ${records.length} 条当前页记录的 CSV 并发起下载。`,
      });
    } catch {
      toast({
        type: 'error',
        title: '无法生成 CSV，请重试或检查浏览器的下载设置。',
      });
    } finally {
      if (url) {
        const downloadUrl = url;
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      }
    }
  }
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-title text-(length:--text-2xl) font-medium">审计日志</h1>
          <p className="mt-2 max-w-prose text-text-secondary">
            查看已记录的用户、节点与设置操作。提交任务的记录不代表任务执行成功。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" disabled={!admin || loading} onClick={refresh}>
            <RefreshCw size={16} aria-hidden="true" />
            刷新日志
          </Button>
          <Button
            variant="secondary"
            onClick={exportCsv}
            disabled={!admin || loading || !loaded || !records.length}
          >
            <Download size={16} aria-hidden="true" />
            导出当前页 CSV
          </Button>
        </div>
      </div>
      {!admin && <p className="text-text-secondary">仅管理员可查看实例审计日志。</p>}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <fieldset
          disabled={!admin || loading}
          className="min-w-0 max-w-full overflow-x-auto disabled:opacity-50"
        >
          <SegmentedControl
            label="筛选审计日志"
            value={filter}
            onValueChange={(value) => {
              if (admin && !loading && value !== filter)
                setRequested({ kind: value, after: '', history: [] });
            }}
            options={[
              { value: 'all', label: '全部' },
              { value: 'user', label: '用户操作' },
              { value: 'system', label: '系统事件' },
            ]}
          />
        </fieldset>
        <p role="status" className="text-(length:--text-xs) text-text-secondary tabular-nums">
          {loading
            ? '正在读取日志…'
            : error
              ? '尚未同步最新日志'
              : loaded
                ? `第 ${history.length + 1} 页，当前页 ${records.length} 条`
                : '尚未读取'}
        </p>
      </div>
      <section aria-label="审计记录" aria-busy={loading} className="v-card">
        <AuditTable
          records={records}
          error={error}
          onRetry={() => setRequested((v) => ({ ...v }))}
          emptyMessage={
            !admin
              ? '需要管理员权限'
              : !loaded
                ? '尚未读取数据'
                : '当前筛选下没有审计记录，请切换到全部'
          }
        />
      </section>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <nav aria-label="审计日志分页" className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={!admin || loading || history.length === 0}
            onClick={() =>
              setRequested({
                kind: filter,
                after: history[history.length - 1],
                history: history.slice(0, -1),
              })
            }
          >
            上一页
          </Button>
          <Button
            variant="secondary"
            disabled={!admin || loading || !nextCursor}
            onClick={() =>
              setRequested({ kind: filter, after: nextCursor, history: [...history, after] })
            }
          >
            下一页
          </Button>
        </nav>
      </div>
    </>
  );
}
