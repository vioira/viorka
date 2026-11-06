import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import {
  listPasskeys,
  type Passkey,
  passkeyError,
  registerPasskey,
  removePasskey,
} from '@/api/login-security';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';
import { Input } from '@/components/arc/input/input';
import { PasswordField } from '@/components/arc/password-field/password-field';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import SettingsSection from './SettingsSection';

export default function PasskeySettings() {
  const [open, setOpen] = useState(false);
  const session = useOutletContext<Session>();
  const [items, setItems] = useState<Passkey[] | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [, error] = useToastFeedback('error');
  const [, success] = useToastFeedback('success');
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const result = await listPasskeys(signal);
        if (!signal?.aborted) setItems(result.items);
      } catch (e) {
        if (!signal?.aborted) error(passkeyError(e));
      }
    },
    [error],
  );
  useEffect(() => {
    const c = new AbortController();
    void refresh(c.signal);
    return () => c.abort();
  }, [refresh]);
  async function run(action: () => Promise<void>, message: string) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      await action();
      setPassword('');
      success(message);
      await refresh();
    } catch (e) {
      error(passkeyError(e));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <SettingsSection
      title="通行密钥"
      description="使用指纹、面容或安全密钥登录，无需输入密码。每个账户最多添加 20 个。"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-text-secondary">
          {items === null ? '密钥数量未知' : `已添加 ${items.length} / 20 个`}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" className="min-h-11" disabled={pending} onClick={() => refresh()}>
            刷新密钥
          </Button>
          <Dialog
            open={open}
            onOpenChange={(value) => {
              if (busy.current) return;
              setOpen(value);
              if (!value) {
                setPassword('');
                setName('');
              }
            }}
          >
            <DialogTrigger asChild>
              <Button
                variant="primary"
                className="min-h-11"
                disabled={pending || items === null || items.length >= 20}
              >
                添加通行密钥
              </Button>
            </DialogTrigger>
            <DialogContent
              title="添加通行密钥"
              description="为密钥命名并验证当前密码，然后按设备提示完成创建。"
            >
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    await registerPasskey(session, password, name);
                    setName('');
                    setOpen(false);
                  }, '通行密钥已添加。');
                }}
              >
                <Input
                  label="密钥名称"
                  value={name}
                  maxLength={64}
                  required
                  disabled={pending}
                  onChange={(e) => setName(e.target.value)}
                />
                <PasswordField
                  label="当前密码"
                  value={password}
                  required
                  autoComplete="current-password"
                  disabled={pending}
                  onChange={(e) => setPassword(e.target.value)}
                  messages={{ showPassword: '显示密码', hidePassword: '隐藏密码' }}
                />
                <div className="flex flex-wrap justify-end gap-3">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => {
                      setOpen(false);
                      setPassword('');
                      setName('');
                    }}
                  >
                    取消
                  </Button>
                  <Button
                    type="submit"
                    loading={pending}
                    disabled={items === null || items.length >= 20}
                  >
                    添加通行密钥
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      {items === null ? (
        <p className="text-text-secondary">通行密钥尚未读取</p>
      ) : items.length === 0 ? (
        <div className="space-y-2 border-t-[0.5px] border-border py-6">
          <p>尚未添加通行密钥</p>
          <p className="text-(length:--text-xs) text-text-secondary">
            添加后可使用设备解锁登录，原有密码仍可使用。
          </p>
        </div>
      ) : (
        <ul className="divide-y-[0.5px] divide-border">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex min-w-0 flex-wrap items-center justify-between gap-4 py-4"
            >
              <div className="min-w-0">
                <p className="wrap-anywhere">{item.name}</p>
                <p className="text-(length:--text-xs) text-text-secondary tabular-nums">
                  创建于 {new Date(item.created_at).toLocaleString()}
                  <br />
                  最近使用：
                  {item.last_used_at ? new Date(item.last_used_at).toLocaleString() : '尚未使用'}
                </p>
              </div>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="secondary" className="min-h-11" disabled={pending}>
                    删除密钥
                  </Button>
                </DialogTrigger>
                <DialogContent
                  title={`删除“${item.name}”？`}
                  description="删除后此密钥无法再登录，你仍可使用密码或其他通行密钥。"
                >
                  <div className="flex flex-wrap gap-3">
                    <DialogClose asChild>
                      <Button variant="secondary">取消</Button>
                    </DialogClose>
                    <Button
                      variant="danger"
                      loading={pending}
                      onClick={() => run(() => removePasskey(session, item.id), '通行密钥已删除。')}
                    >
                      确认删除
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}
