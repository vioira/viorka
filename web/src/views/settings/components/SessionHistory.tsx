import { Laptop, RefreshCw, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import {
  type SessionHistory as History,
  listSessions,
  passkeyError,
  revokeSession,
  type SessionRecord,
} from '@/api/login-security';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';
import { Drawer, DrawerContent, DrawerTrigger } from '@/components/arc/drawer/drawer';
import { Input } from '@/components/arc/input/input';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import EndSessionsDialog from './EndSessionsDialog';
import SessionDetails, { device, time } from './SessionDetails';

function SessionCard({
  record,
  disabled,
  onRevoke,
}: {
  record: SessionRecord;
  disabled: boolean;
  onRevoke: (record: SessionRecord) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const Icon = /Mobile|Android|iPhone|iPad/.test(record.user_agent) ? Smartphone : Laptop;
  const action = record.current ? '退出当前会话' : '撤销会话';
  return (
    <li className="min-w-0 rounded-(--radius-control) border-[1px] border-border p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <Icon size={20} className="mt-1 shrink-0 text-text-secondary" aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="wrap-anywhere font-medium">{device(record.user_agent)}</h3>
            <p className="mt-1 flex flex-wrap gap-x-3 text-(length:--text-sm) text-text-secondary">
              <span>{record.username}</span>
              <span>{record.method === 'passkey' ? '通行密钥' : '账户密码'}</span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-(length:--text-xs)">
          {record.current && (
            <span className="rounded-(--radius-pill) bg-accent-subtle px-3 py-1 text-accent">
              当前会话
            </span>
          )}
          <span className="rounded-(--radius-pill) bg-surface-muted px-3 py-1">
            {record.ended_at ? '已结束' : '有效'}
          </span>
        </div>
      </div>
      <dl className="my-5 grid min-w-0 grid-cols-1 gap-5 text-(length:--text-sm) md:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-text-secondary">最新 IP</dt>
          <dd className="mt-1 wrap-anywhere tabular-nums">{record.latest_ip || '未记录'}</dd>
          <dd className="mt-1 wrap-anywhere text-text-secondary">
            {record.latest_location || '归属地未知'}
          </dd>
        </div>
        <div>
          <dt className="text-text-secondary">首次登录</dt>
          <dd className="mt-1 tabular-nums">{time(record.created_at)}</dd>
        </div>
        <div>
          <dt className="text-text-secondary">最近活动</dt>
          <dd className="mt-1 tabular-nums">{time(record.last_active_at)}</dd>
        </div>
        <div>
          <dt className="text-text-secondary">{record.ended_at ? '结束时间' : '到期时间'}</dt>
          <dd className="mt-1 tabular-nums">{time(record.ended_at || record.expires_at)}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-(length:--text-xs) text-text-secondary">
          会话 <span className="font-mono">{record.id.slice(0, 12)}…</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <Drawer>
            <DrawerTrigger asChild>
              <Button variant="ghost">查看详情</Button>
            </DrawerTrigger>
            <DrawerContent
              title={device(record.user_agent)}
              description="登录来源、活动时间与 IP 历史"
            >
              <SessionDetails record={record} />
            </DrawerContent>
          </Drawer>
          {!record.ended_at && (
            <Dialog
              open={open}
              onOpenChange={(value) => {
                if (!revoking) setOpen(value);
              }}
            >
              <DialogTrigger asChild>
                <Button variant="secondary" disabled={disabled}>
                  {action}
                </Button>
              </DialogTrigger>
              <DialogContent
                title={`${action}？`}
                description={
                  record.current
                    ? '当前浏览器将退出，需要重新登录。'
                    : '该设备将无法继续使用此会话，需要重新登录。'
                }
                footer={
                  <>
                    <Button variant="secondary" disabled={revoking} onClick={() => setOpen(false)}>
                      取消
                    </Button>
                    <Button
                      variant="danger"
                      loading={revoking}
                      disabled={disabled}
                      onClick={async () => {
                        setRevoking(true);
                        try {
                          if (await onRevoke(record)) setOpen(false);
                        } finally {
                          setRevoking(false);
                        }
                      }}
                    >
                      {action}
                    </Button>
                  </>
                }
              >
                <p className="wrap-anywhere text-(length:--text-sm)">
                  {record.username} / {device(record.user_agent)}
                  <br />
                  {record.latest_ip || 'IP 未记录'}
                </p>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>
    </li>
  );
}

export default function SessionHistory() {
  const session = useOutletContext<Session>();
  const navigate = useNavigate();
  const [history, setHistory] = useState<History | null>(null);
  const [pending, setPending] = useState(true);
  const [view, setView] = useState('active');
  const [query, setQuery] = useState('');
  const busy = useRef(false);
  const request = useRef<AbortController | null>(null);
  const [, error] = useToastFeedback('error');
  const [, success] = useToastFeedback('success');
  const refresh = useCallback(
    async (after = '') => {
      if (busy.current) return;
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      setPending(true);
      try {
        const next = await listSessions(after, controller.signal);
        if (!controller.signal.aborted) {
          setHistory((previous) => ({
            ...next,
            items: after
              ? Array.from(
                  new Map(
                    [...(previous?.items ?? []), ...next.items].map((item) => [item.id, item]),
                  ).values(),
                )
              : next.items,
          }));
          error('');
        }
      } catch (e) {
        if (!controller.signal.aborted) error(passkeyError(e));
      } finally {
        if (!controller.signal.aborted) setPending(false);
      }
    },
    [error],
  );
  useEffect(() => {
    void refresh();
    return () => request.current?.abort();
  }, [refresh]);
  const records = history?.items ?? [];
  const active = records.filter((record) => !record.ended_at);
  const ended = records.filter((record) => record.ended_at);
  const search = query.trim().toLocaleLowerCase();
  const visible = (view === 'active' ? active : ended)
    .filter((record) =>
      [
        record.username,
        record.id,
        record.first_ip,
        record.latest_ip,
        record.first_location,
        record.latest_location,
        device(record.user_agent),
      ].some((value) => value.toLocaleLowerCase().includes(search)),
    )
    .sort(
      (a, b) =>
        Number(b.current) - Number(a.current) ||
        Date.parse(b.last_active_at) - Date.parse(a.last_active_at),
    );
  async function revoke(record: SessionRecord) {
    if (busy.current) return false;
    busy.current = true;
    request.current?.abort();
    setPending(true);
    try {
      await revokeSession(session, record.id);
      success(record.current ? '当前会话已退出。' : '会话已撤销。');
      if (record.current) await navigate('/login', { replace: true });
      else {
        setHistory(
          (previous) =>
            previous && {
              ...previous,
              items: previous.items.filter((item) => item.id !== record.id),
            },
        );
        busy.current = false;
        await refresh();
      }
      return true;
    } catch (e) {
      error(passkeyError(e));
      return false;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <section
      aria-labelledby="login-sessions-title"
      className="v-card space-y-5 text-(length:--text-sm) text-foreground"
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="login-sessions-title" className="v-card-title">
            登录会话
          </h2>
          <p className="v-card-description">仅显示自己的会话。有效不代表设备当前在线。</p>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          label="会话类型"
          value={view}
          onValueChange={setView}
          options={[
            {
              value: 'active',
              label: '有效会话',
              accessory: history && <span className="tabular-nums">{active.length}</span>,
            },
            {
              value: 'history',
              label: '历史记录',
              accessory: history && <span className="tabular-nums">{ended.length}</span>,
            },
          ]}
        />
        <div className="w-full min-w-0 sm:w-64">
          <Input
            label="搜索已加载会话"
            hideLabel
            type="search"
            placeholder="搜索用户、IP、设备或地区"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="ml-auto flex shrink-0 justify-end">
          <Button variant="secondary" loading={pending} onClick={() => refresh()}>
            <RefreshCw size={16} aria-hidden="true" />
            刷新会话
          </Button>
        </div>
      </div>

      <div aria-busy={pending} className="min-h-48">
        {history === null ? (
          <p className="py-12 text-center text-(length:--text-sm) text-text-secondary">
            {pending ? '正在读取登录会话…' : '会话尚未读取，请刷新重试'}
          </p>
        ) : visible.length === 0 ? (
          <div className="py-12 text-center text-(length:--text-sm) text-text-secondary">
            <p>
              {search
                ? '已加载记录中没有匹配的会话'
                : view === 'active'
                  ? '已加载记录中没有有效会话'
                  : '已加载记录中没有已结束会话'}
            </p>
            {search && (
              <Button variant="ghost" className="mt-3" onClick={() => setQuery('')}>
                清除搜索
              </Button>
            )}
          </div>
        ) : (
          <ul className="space-y-4">
            {visible.map((record) => (
              <SessionCard key={record.id} record={record} disabled={pending} onRevoke={revoke} />
            ))}
          </ul>
        )}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-4 border-t-[1px] border-border pt-4">
        <div>
          {history?.next_cursor && (
            <Button
              variant="secondary"
              loading={pending}
              onClick={() => refresh(history.next_cursor)}
            >
              加载更多会话
            </Button>
          )}
        </div>
        <EndSessionsDialog />
      </footer>
    </section>
  );
}
