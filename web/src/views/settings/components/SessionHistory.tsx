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
import { Drawer, DrawerContent, DrawerTrigger } from '@/components/arc/drawer/drawer';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import EndSessionsDialog from './EndSessionsDialog';
import SettingsSection from './SettingsSection';

const reasons: Record<string, string> = {
  logout: '主动退出',
  logout_all: '退出全部会话',
  revoked: '会话已撤销',
  expired: '会话到期',
  password_changed: '密码已修改',
  role_changed: '角色已变更',
  account_disabled: '账户已禁用',
};
function time(value: string) {
  return value ? new Date(value).toLocaleString() : '未记录';
}
function device(ua: string) {
  const browser = ua.match(/(Edg)\/([\d.]+)/) ?? ua.match(/(Firefox|Chrome|Version)\/([\d.]+)/);
  const names: Record<string, string> = { Edg: 'Edge', Version: 'Safari' };
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Macintosh/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '未知系统';
  return `${browser ? `${names[browser[1]] ?? browser[1]} ${browser[2]}` : '未知浏览器'} / ${os}`;
}
function Details({ record }: { record: SessionRecord }) {
  const fields = [
    ['登录用户', record.username],
    ['登录方式', record.method === 'passkey' ? '通行密钥' : '账户密码'],
    ['登录来源', record.source || '未记录'],
    ['用户 ID', record.user_id],
    ['首次登录 IP', record.first_ip || '未记录'],
    ['首次登录归属地', record.first_location],
    ['最新 IP', record.latest_ip || '未记录'],
    ['最新归属地', record.latest_location],
    [
      '设备类型',
      !record.user_agent
        ? '未知'
        : /Mobile|Android|iPhone|iPad/.test(record.user_agent)
          ? '移动设备'
          : '电脑',
    ],
    ['登录时间', time(record.created_at)],
    ['最近活动', time(record.last_active_at)],
    ['到期时间', time(record.expires_at)],
    ['结束时间', record.ended_at ? time(record.ended_at) : '尚未结束'],
    ['结束原因', reasons[record.end_reason] || '会话有效'],
  ];
  return (
    <div className="space-y-6 text-(length:--text-sm)">
      <p>
        {record.current ? '当前会话 / ' : ''}
        {record.ended_at ? '已结束' : '有效'}
      </p>
      <section aria-label="登录身份与来源">
        <h3 className="mb-4 font-medium">登录身份与来源</h3>
        <dl className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
          {fields.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-text-secondary">{label}</dt>
              <dd className="mt-1 wrap-anywhere tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-label="User-Agent">
        <h3 className="mb-2 font-medium">User-Agent</h3>
        <p className="wrap-anywhere text-text-secondary">{record.user_agent || '未记录'}</p>
      </section>
      <section aria-label="会话 IP 历史">
        <h3 className="font-medium">会话 IP 历史</h3>
        <p className="mt-2 text-text-secondary">
          相同 IP 合并，显示最近使用的 100 个地址。归属地为近似值。
        </p>
        <ul className="mt-4 divide-y-[0.5px] divide-border">
          {record.ips.map((ip) => (
            <li key={ip.ip} className="space-y-2 py-4">
              <p className="wrap-anywhere font-mono">{ip.ip}</p>
              <p className="text-text-secondary">{ip.location || '归属地未知'}</p>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-text-secondary">首次使用</dt>
                  <dd className="tabular-nums">{time(ip.first_used_at)}</dd>
                </div>
                <div>
                  <dt className="text-text-secondary">最近使用</dt>
                  <dd className="tabular-nums">{time(ip.last_used_at)}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
        {record.ips.length === 0 && <p>未记录 IP</p>}
      </section>
    </div>
  );
}
export default function SessionHistory() {
  const session = useOutletContext<Session>();
  const navigate = useNavigate();
  const [history, setHistory] = useState<History | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [, error] = useToastFeedback('error');
  const [, success] = useToastFeedback('success');
  const refresh = useCallback(
    async (after = '', signal?: AbortSignal) => {
      if (busy.current) return;
      busy.current = true;
      setPending(true);
      try {
        const next = await listSessions(after, signal);
        if (!signal?.aborted)
          setHistory((previous) => ({
            ...next,
            items: after ? [...(previous?.items ?? []), ...next.items] : next.items,
          }));
      } catch (e) {
        if (!signal?.aborted) error(passkeyError(e));
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [error],
  );
  useEffect(() => {
    const controller = new AbortController();
    setPending(true);
    listSessions('', controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setHistory(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted) error(passkeyError(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setPending(false);
      });
    return () => controller.abort();
  }, [error]);
  return (
    <SettingsSection
      layout="split"
      title="登录会话"
      description="会话有效期为 12 小时，支持多个设备同时登录。最近活动指通过验证的 API 请求时间。"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-text-secondary">查看设备与登录历史，及时退出不再使用的会话。</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" className="min-h-11" loading={pending} onClick={() => refresh()}>
            刷新会话
          </Button>
          <EndSessionsDialog />
        </div>
      </div>
      <div aria-busy={pending}>
        {history === null ? (
          <p className="text-text-secondary">登录历史尚未读取</p>
        ) : history.items.length === 0 ? (
          <p className="text-text-secondary">暂无登录记录</p>
        ) : (
          <ul className="divide-y-[0.5px] divide-border">
            {history.items.map((record) => (
              <li
                key={record.id}
                className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
              >
                <div className="min-w-0">
                  <p className="wrap-anywhere">{device(record.user_agent)}</p>
                  <p className="text-(length:--text-xs) text-text-secondary">
                    {record.current ? '当前会话 / ' : ''}
                    {record.ended_at ? reasons[record.end_reason] || '已结束' : '有效'}
                  </p>
                </div>
                <p className="col-span-2 row-start-2 wrap-anywhere text-(length:--text-xs) text-text-secondary tabular-nums xl:col-span-1 xl:row-auto">
                  最近活动 {time(record.last_active_at)}
                  <br />
                  {record.latest_ip || 'IP 未记录'}
                </p>
                <Drawer>
                  <DrawerTrigger asChild>
                    <Button
                      variant="secondary"
                      className="col-start-2 row-start-1 min-h-11 xl:col-start-3"
                    >
                      查看会话
                    </Button>
                  </DrawerTrigger>
                  <DrawerContent
                    title={device(record.user_agent)}
                    description="登录来源、活动时间与 IP 历史"
                  >
                    <Details record={record} />
                    {!record.ended_at && (
                      <Button
                        variant="secondary"
                        className="mt-6 min-h-11"
                        disabled={pending}
                        onClick={async () => {
                          if (busy.current) return;
                          busy.current = true;
                          setPending(true);
                          try {
                            await revokeSession(session, record.id);
                            success('会话已撤销。');
                            if (record.current) {
                              await navigate('/login', { replace: true });
                              return;
                            }
                          } catch (e) {
                            error(passkeyError(e));
                          } finally {
                            busy.current = false;
                            setPending(false);
                          }
                          await refresh();
                        }}
                      >
                        撤销此会话
                      </Button>
                    )}
                  </DrawerContent>
                </Drawer>
              </li>
            ))}
          </ul>
        )}
      </div>
      {history?.next_cursor && (
        <Button
          variant="secondary"
          className="min-h-11"
          loading={pending}
          onClick={() => refresh(history.next_cursor)}
        >
          加载更多历史
        </Button>
      )}
    </SettingsSection>
  );
}
