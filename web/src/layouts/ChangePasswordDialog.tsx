import { type RefObject, useRef, useState } from 'react';
import type { Session } from '@/api/auth';
import { changePassword } from '@/api/settings';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { PasswordField } from '@/components/arc/password-field/password-field';
import { useToastFeedback } from '@/hooks/use-toast-feedback';

const messages = { showPassword: '显示密码', hidePassword: '隐藏密码' };
export default function ChangePasswordDialog({
  session,
  open,
  onOpenChange,
  returnFocus,
}: {
  session: Session;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocus: RefObject<HTMLButtonElement | null>;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const currentInput = useRef<HTMLInputElement>(null);
  const [, error] = useToastFeedback('error');
  const [, success] = useToastFeedback('success');
  function close() {
    if (busy.current) return;
    onOpenChange(false);
    setCurrent('');
    setNext('');
    setConfirmation('');
    error('');
  }
  async function submit() {
    if (busy.current) return;
    const bytes = new TextEncoder().encode(next).length;
    if (bytes < 12 || bytes > 72) {
      error('新密码需为 12 到 72 字节，请调整后重试。');
      return;
    }
    if (next === current) {
      error('新密码不能与当前密码相同。');
      return;
    }
    if (next !== confirmation) {
      error('两次输入的新密码不一致，请重新确认。');
      return;
    }
    busy.current = true;
    setPending(true);
    error('');
    try {
      await changePassword(session, current, next);
      setCurrent('');
      setNext('');
      setConfirmation('');
      onOpenChange(false);
      success('密码已更新，其他会话已退出，当前会话继续有效。');
    } catch (cause) {
      error(cause instanceof Error ? cause.message : '密码未更新，请重试。');
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) close();
      }}
    >
      <DialogContent
        title="修改密码"
        description="更新后其他设备的登录会话将失效，当前会话继续有效。"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          currentInput.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus.current?.focus();
        }}
      >
        <form
          className="space-y-5"
          aria-busy={pending}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <PasswordField
            ref={currentInput}
            label="当前密码"
            name="current-password"
            autoComplete="current-password"
            messages={messages}
            required
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            disabled={pending}
          />
          <PasswordField
            label="新密码"
            name="new-password"
            autoComplete="new-password"
            messages={messages}
            required
            description="12 到 72 字节，不能与当前密码相同。"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            disabled={pending}
          />
          <PasswordField
            label="确认新密码"
            name="confirm-password"
            autoComplete="new-password"
            messages={messages}
            required
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            disabled={pending}
          />
          <div className="flex flex-wrap justify-end gap-3 border-t-[0.5px] border-border pt-5">
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              disabled={pending}
              onClick={close}
            >
              取消
            </Button>
            <Button type="submit" variant="primary" className="min-h-11" loading={pending}>
              更新密码
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
