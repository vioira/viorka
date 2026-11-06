import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import {
  type BackupList,
  cancelRestore,
  createBackup,
  listBackups,
  restoreBackup,
} from '@/api/settings';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';
import { PasswordField } from '@/components/arc/password-field/password-field';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import SettingsSection from './SettingsSection';
export default function BackupSettings() {
  const session = useOutletContext<Session>();
  const admin = session.user.role === 'admin';
  const [data, setData] = useState<BackupList | null>(null);
  const [error, setError] = useToastFeedback('error');
  const [, setNotice] = useToastFeedback('success');
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const [password, setPassword] = useState('');
  const reload = useCallback(async () => {
    setError('');
    try {
      setData(await listBackups());
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法加载备份，请重试。');
    }
  }, [setError]);
  useEffect(() => {
    if (!admin) return;
    const controller = new AbortController();
    listBackups(controller.signal)
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : '无法加载备份，请重试。');
      });
    return () => controller.abort();
  }, [admin, setError]);
  async function run(action: () => Promise<unknown>, message: string) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(message);
      setPassword('');
      setOpen(false);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作未完成，请重试。');
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  const latest = data?.items[0];
  return (
    <SettingsSection
      layout="split"
      title="备份与恢复"
      description="保存面板配置与账户信息的加密快照。恢复计划将在下次重启 Panel 时执行。"
    >
      <dl className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-2">
          <dt className="text-text-secondary">最近备份</dt>
          <dd className="tabular-nums">
            {latest ? (
              <time dateTime={latest.created_at}>
                {new Date(latest.created_at).toLocaleString('zh-CN')}
              </time>
            ) : data ? (
              '暂无备份'
            ) : admin ? (
              error ? (
                '未能读取'
              ) : (
                '正在加载…'
              )
            ) : (
              '仅管理员可查看'
            )}
          </dd>
        </div>
        <div className="space-y-2">
          <dt className="text-text-secondary">保留策略</dt>
          <dd className="tabular-nums">14 天</dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-3 border-t-[0.5px] border-border pt-5">
        <Button variant="ghost" className="min-h-11" disabled={!admin || pending} onClick={reload}>
          刷新备份
        </Button>
        <Button
          variant="secondary"
          className="min-h-11"
          disabled={!admin || pending}
          loading={pending}
          onClick={() => run(() => createBackup(session), '备份已创建并加密保存。')}
        >
          立即备份
        </Button>
        <Dialog
          open={open}
          onOpenChange={(value) => {
            if (busy.current) return;
            setOpen(value);
            if (!value) {
              setPassword('');
              setSelected('');
            }
          }}
        >
          <DialogTrigger asChild>
            <Button variant="secondary" disabled={!admin || pending || !data?.items.length}>
              从备份恢复
            </Button>
          </DialogTrigger>
          <DialogContent
            title="从备份恢复？"
            description="恢复会替换当前数据库并使全部会话失效。确认后将在下一次重启 Panel 时执行，恢复前会保留当前数据库快照。"
          >
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void run(
                  () => restoreBackup(session, selected, password),
                  '恢复计划已保存。请重启 Panel，随后使用备份中的账号重新登录。',
                );
              }}
            >
              <div
                className="max-h-56 space-y-2 overflow-y-auto"
                role="group"
                aria-label="选择备份"
              >
                {data?.items.map((item) => (
                  <Button
                    key={item.id}
                    variant={selected === item.id ? 'primary' : 'secondary'}
                    aria-pressed={selected === item.id}
                    className="w-full"
                    type="button"
                    disabled={pending}
                    onClick={() => setSelected(item.id)}
                  >
                    {new Date(item.created_at).toLocaleString('zh-CN')} (
                    {Math.ceil(item.size / 1024)} KB)
                  </Button>
                ))}
                {data?.items.length === 0 && <p>暂无可恢复备份，请先创建备份。</p>}
              </div>
              <PasswordField
                disabled={pending}
                label="当前密码"
                messages={{ showPassword: '显示密码', hidePassword: '隐藏密码' }}
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <DialogClose asChild>
                  <Button variant="secondary" disabled={pending}>
                    取消
                  </Button>
                </DialogClose>
                <Button
                  type="submit"
                  variant="danger"
                  disabled={!selected || pending}
                  loading={pending}
                >
                  确认恢复
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      {data?.pending_restore && (
        <div className="space-y-2">
          <p role="status">有一个恢复计划等待重启。重启前可取消。</p>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => run(() => cancelRestore(session), '恢复计划已取消。')}
          >
            取消恢复计划
          </Button>
        </div>
      )}
    </SettingsSection>
  );
}
