import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import { type EnrollmentRecord, listEnrollments, revokeEnrollment } from '@/api/enrollment';
import { Button } from '@/components/arc/button/button';
import DataTable, { type DataColumn } from '@/components/data-table';
import { EnrollmentGuide, GenerateEnrollment } from '@/components/enrollment/EnrollmentDialogs';
import { useToastFeedback } from '@/hooks/use-toast-feedback';

export default function EnrollmentSettings() {
  const session = useOutletContext<Session>();
  const admin = session.user.role === 'admin';
  const titleId = useId();
  const [records, setRecords] = useState<EnrollmentRecord[]>([]);
  const [pending, setPending] = useState('');
  const busy = useRef(false);
  const [, setError] = useToastFeedback('error');
  const [, setNotice] = useToastFeedback('success');
  const [now, setNow] = useState(0);
  const [after, setAfter] = useState('');
  const [pages, setPages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [listError, setListError] = useState('');
  const reload = useCallback(async () => {
    if (!admin) return;
    setLoading(true);
    setListError('');
    try {
      setRecords((await listEnrollments(after)).items);
      setHasLoaded(true);
    } catch (e) {
      setListError(e instanceof Error ? e.message : '无法加载令牌记录，请重试。');
    } finally {
      setLoading(false);
    }
  }, [admin, after]);
  useEffect(() => {
    if (!admin) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setListError('');
    listEnrollments(after, controller.signal)
      .then((v) => {
        setRecords(v.items);
        setHasLoaded(true);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setListError(e instanceof Error ? e.message : '无法加载令牌记录，请重试。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [admin, after]);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  async function revoke(id: string) {
    if (!admin || busy.current) return;
    busy.current = true;
    setPending(id);
    setError('');
    setNotice('');
    try {
      await revokeEnrollment(session, id);
      await reload();
      setNotice('注册令牌已吊销，已注册的节点不受影响。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '吊销未完成，请稍后重试。');
    } finally {
      busy.current = false;
      setPending('');
    }
  }
  const columns: DataColumn<EnrollmentRecord>[] = [
    {
      key: 'id',
      label: '令牌',
      render: (_, row) => (
        <span className="font-mono" title={row.id}>
          {row.id.slice(0, 8)}…
        </span>
      ),
    },
    {
      key: 'name',
      label: '节点',
      render: (_, row) => <span className="break-all">{row.name}</span>,
    },
    {
      key: 'expires_at',
      label: '到期时间',
      render: (_, row) => (
        <time className="tabular-nums" dateTime={row.expires_at}>
          {new Date(row.expires_at).toLocaleString('zh-CN')}
        </time>
      ),
    },
    {
      key: 'state',
      sortable: false,
      label: '状态',
      render: (_, row) =>
        ({
          active: Date.parse(row.expires_at) <= now ? '已过期' : '待使用',
          used: '已使用',
          expired: '已过期',
          revoked: '已吊销',
        })[row.state],
    },
    {
      key: 'actions',
      sortable: false,
      label: '操作',
      render: (_, row) => (
        <Button
          variant="ghost"
          disabled={
            !admin || !!pending || row.state !== 'active' || Date.parse(row.expires_at) <= now
          }
          loading={pending === row.id}
          onClick={() => revoke(row.id)}
          aria-label={`吊销 ${row.name} 的注册令牌`}
        >
          吊销令牌
        </Button>
      ),
    },
  ];
  return (
    <section aria-labelledby={titleId} className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h2 id={titleId} className="font-medium text-foreground">
            令牌记录
          </h2>
          <EnrollmentGuide />
        </div>
        <GenerateEnrollment
          session={session}
          disabled={!admin || !!pending}
          onCreated={async () => {
            setPages([]);
            if (after) setAfter('');
            else await reload();
          }}
        />
      </div>
      {!admin && (
        <p className="text-(length:--text-xs) text-text-secondary">
          仅管理员可查看、生成或吊销注册令牌。
        </p>
      )}
      <div aria-busy={loading}>
        <DataTable
          loading={loading && !hasLoaded}
          error={listError}
          onRetry={admin ? reload : undefined}
          columns={columns}
          rows={records}
          rowKey={(row) => row.id}
          caption="注册令牌记录"
          emptyMessage={admin ? '暂无注册令牌，点击“生成注册令牌”添加。' : '无权查看令牌记录'}
          tableClassName="min-w-140"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="secondary"
          disabled={!admin || loading || !!pending}
          loading={loading}
          onClick={reload}
        >
          刷新记录
        </Button>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={!pages.length || loading || !!pending}
            onClick={() => {
              setAfter(pages[pages.length - 1]);
              setPages(pages.slice(0, -1));
            }}
          >
            上一页
          </Button>
          <Button
            variant="secondary"
            disabled={records.length < 50 || loading || !!pending || !!listError}
            onClick={() => {
              setPages([...pages, after]);
              setAfter(records[records.length - 1].id);
            }}
          >
            下一页
          </Button>
        </div>
      </div>
    </section>
  );
}
