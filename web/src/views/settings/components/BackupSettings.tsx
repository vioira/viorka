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
      title="备份与恢复"
      description="SQLite 数据库包含配置与身份信息，备份文件加密保存。恢复前必须停止 Panel 进程并校验快照完整性。"
    >
      <dl className="space-y-4">
        <div className="flex flex-wrap justify-between gap-2">
          <dt>最近备份</dt>
          <dd>
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
        <div className="flex flex-wrap justify-between gap-2">
          <dt>保留策略</dt>
          <dd>14 天</dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={!admin || pending} onClick={reload}>
          刷新备份
        </Button>
        <Button
          variant="secondary"
          disabled={!admin || pending}
          loading={pending}
          onClick={() => run(() => createBackup(session), '备份已创建并加密保存。')}
        >
          立即备份
        </Button>
        <Dialog
          open={open}
          onOpenChange={(value) => {
            setOpen(value);
            if (!value) setPassword('');
          }}
        >
          <DialogTrigger asChild>
            <Button variant="danger" disabled={!admin || pending}>
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
                    onClick={() => setSelected(item.id)}
                  >
                    {new Date(item.created_at).toLocaleString('zh-CN')} (
                    {Math.ceil(item.size / 1024)} KB)
                  </Button>
                ))}
                {data?.items.length === 0 && <p>暂无可恢复备份，请先创建备份。</p>}
              </div>
              <PasswordField
                label="当前密码"
                messages={{ showPassword: '显示密码', hidePassword: '隐藏密码' }}
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <DialogClose asChild>
                  <Button variant="secondary">取消</Button>
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
