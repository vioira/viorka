import { Download, Eye, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router';
import { type AuditRecord, listAuditLogs } from '@/api/audit';
import type { Session } from '@/api/auth';
import { Button } from '@/components/arc/button/button';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import Pagination from '@/components/pagination';
import { type Cursor, cursorForPage, firstCursor } from '@/hooks/cursor-page';
import AuditTable from './components/AuditTable';
import { auditCsv } from './export';

type AuditView = Cursor & { kind: string; pageSize: number };
const defaultView: AuditView = { kind: 'all', pageSize: 50, ...firstCursor };
const pageSizes = [10, 20, 50, 100];

export default function AuditLogsPage() {
  const { toast } = useToastStack();
  const session = useOutletContext<Session>();
  const admin = session.user.role === 'admin';
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [view, setView] = useState(defaultView);
  const filter = view.kind;
  const [nextCursor, setNextCursor] = useState('');
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  // Commit the selected view only on success, so failed navigation retains its context.
  const [requested, setRequested] = useState(defaultView);
  useEffect(() => {
    if (!admin) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    listAuditLogs(requested.kind, requested.after, controller.signal, requested.pageSize)
      .then((result) => {
        if (controller.signal.aborted) return;
        setRecords(result.items);
        setNextCursor(result.nextCursor);
        setLoaded(true);
        setView(requested);
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
    setRequested({ ...view });
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
      {!admin && <p className="text-text-secondary">仅管理员可查看实例审计日志。</p>}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <fieldset
            disabled={!admin || loading}
            className="min-w-0 max-w-full overflow-x-auto disabled:opacity-50"
          >
            <SegmentedControl
              label="筛选审计日志"
              value={filter}
              onValueChange={(value) => {
                if (admin && !loading && value !== filter)
                  setRequested({ ...view, kind: value, ...firstCursor });
              }}
              options={[
                { value: 'all', label: '全部' },
                { value: 'user', label: '用户操作' },
                { value: 'system', label: '系统事件' },
              ]}
            />
          </fieldset>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <Button
              loading={loading}
              variant="secondary"
              disabled={!admin || loading}
              onClick={refresh}
            >
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
        {loaded && error && (
          <p role="status" className="text-(length:--text-xs) text-text-secondary">
            尚未同步最新日志
          </p>
        )}
      </div>
      <section aria-label="审计记录" className="v-card">
        <AuditTable
          loaded={!admin || loaded}
          loading={loading}
          emptyState={{
            variant: !admin ? 'forbidden' : filter !== 'all' ? 'no-results' : 'empty',
            action:
              admin && filter !== 'all' ? (
                <Button
                  variant="secondary"
                  disabled={loading}
                  onClick={() => setRequested({ ...view, kind: 'all', ...firstCursor })}
                >
                  <Eye size={16} aria-hidden="true" />
                  查看全部日志
                </Button>
              ) : undefined,
          }}
          records={records}
          error={error}
          onRetry={() => setRequested((v) => ({ ...v }))}
          emptyMessage={
            !admin ? '需要管理员权限' : filter === 'all' ? '暂无审计记录' : '没有匹配的审计记录'
          }
        />
      </section>
      {admin && loaded && (
        <Pagination
          label="审计日志分页"
          page={view.history.length + 1}
          hasNext={!!nextCursor}
          busy={loading}
          onPageChange={(page) => {
            const cursor = cursorForPage(view, page, nextCursor);
            if (cursor !== view) setRequested({ ...view, ...cursor });
          }}
          pageSize={{
            value: view.pageSize,
            options: pageSizes,
            onChange: (pageSize) => {
              if (pageSize !== view.pageSize) setRequested({ ...view, ...firstCursor, pageSize });
            },
          }}
        />
      )}
    </>
  );
}
