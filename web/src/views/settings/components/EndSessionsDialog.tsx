import { useRef, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import { logoutAll } from '@/api/settings';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';
import { useToastFeedback } from '@/hooks/use-toast-feedback';

export default function EndSessionsDialog() {
  const session = useOutletContext<Session>();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [, error] = useToastFeedback('error');
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy.current) setOpen(value);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">退出全部会话</Button>
      </DialogTrigger>
      <DialogContent
        title="退出全部会话？"
        description="所有设备（包括当前浏览器）都会退出，需要使用密码或通行密钥重新登录。"
        footer={
          <>
            <Button variant="secondary" disabled={pending} onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              variant="danger"
              loading={pending}
              onClick={async () => {
                if (busy.current) return;
                busy.current = true;
                setPending(true);
                error('');
                try {
                  await logoutAll(session);
                  await navigate('/login', { replace: true });
                } catch (e) {
                  error(e instanceof Error ? e.message : '退出未完成，请重试。');
                } finally {
                  busy.current = false;
                  setPending(false);
                }
              }}
            >
              确认退出全部
            </Button>
          </>
        }
      />
    </Dialog>
  );
}
