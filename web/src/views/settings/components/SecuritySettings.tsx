import { useEffect, useRef, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import { changePassword, logoutAll } from '@/api/settings';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';
import { PasswordField } from '@/components/arc/password-field/password-field';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import BackupSettings from './BackupSettings';
import SettingsSection from './SettingsSection';

const messages = { showPassword: '显示密码', hidePassword: '隐藏密码' };
export default function SecuritySettings() {
  const session = useOutletContext<Session>();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [, setFeedback] = useToastFeedback('success');
  const [, setError] = useToastFeedback('error');
  const [, setLogoutError] = useToastFeedback('error');
  const [expiry, setExpiry] = useState(session.expires_at);
  useEffect(
    () => setExpiry(new Date(session.expires_at).toLocaleString('zh-CN')),
    [session.expires_at],
  );
  async function updatePassword() {
    if (busy.current) return;
    setError('');
    setFeedback('');
    const bytes = new TextEncoder().encode(next).length;
    if (bytes < 12 || bytes > 72) {
      setError('新密码需为 12 到 72 字节。');
      return;
    }
    busy.current = true;
    setPending(true);
    try {
      await changePassword(session, current, next);
      setCurrent('');
      setNext('');
      setFeedback('密码已更新，其他会话已失效。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '密码未更新，请重试。');
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <SettingsSection title="修改密码">
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              void updatePassword();
            }}
          >
            <PasswordField
              messages={messages}
              label="当前密码"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              autoComplete="current-password"
              required
              disabled={pending}
            />
            <PasswordField
              messages={messages}
              label="新密码"
              value={next}
              onChange={(event) => setNext(event.target.value)}
              autoComplete="new-password"
              required
              disabled={pending}
              placeholder="12 到 72 字节"
              description="修改后其他会话立即失效。"
            />
            <Button type="submit" loading={pending}>
              更新密码
            </Button>
          </form>
        </SettingsSection>
        <SettingsSection title="活动会话">
          <dl className="space-y-4">
            <div className="flex flex-wrap justify-between gap-2">
              <dt>当前浏览器</dt>
              <dd className="break-all text-foreground">{session.user.username}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <dt>到期时间</dt>
              <dd className="text-foreground tabular-nums">
                <time dateTime={session.expires_at}>{expiry}</time>
              </dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <dt>会话策略</dt>
              <dd>每用户仅一个活动会话</dd>
            </div>
          </dl>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary">退出全部会话</Button>
            </DialogTrigger>
            <DialogContent
              title="退出全部会话？"
              description="包括当前浏览器在内的所有会话都会失效，需要重新登录。"
            >
              <div className="flex flex-wrap gap-2">
                <DialogClose asChild>
                  <Button variant="secondary">取消</Button>
                </DialogClose>
                <Button
                  loading={pending}
                  onClick={async () => {
                    if (busy.current) return;
                    busy.current = true;
                    setPending(true);
                    setLogoutError('');
                    try {
                      await logoutAll(session);
                      await navigate('/login', { replace: true });
                    } catch (e) {
                      setLogoutError(e instanceof Error ? e.message : '退出未完成，请重试。');
                    } finally {
                      busy.current = false;
                      setPending(false);
                    }
                  }}
                >
                  退出全部
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </SettingsSection>
      </div>
      <BackupSettings />
    </div>
  );
}
