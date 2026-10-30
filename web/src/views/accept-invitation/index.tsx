import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { acceptInvitation } from '@/api/users';
import { Button } from '@/components/arc/button/button';
import { PasswordField } from '@/components/arc/password-field/password-field';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
export default function AcceptInvitationPage() {
  const captured = useRef(false);
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [, setError] = useToastFeedback('error');
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (captured.current) return;
    captured.current = true;
    setToken(location.hash.slice(1));
    history.replaceState(null, '', location.pathname);
  }, []);
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-6 p-6 text-foreground">
      <h1 className="font-title text-(length:--text-2xl) font-medium">加入 Viorka</h1>
      {done ? (
        <>
          <p role="status">账号已创建，请使用邀请中的用户名与新密码登录。</p>
          <Link to="/login" className="text-accent">
            前往登录
          </Link>
        </>
      ) : (
        <form
          className="space-y-5"
          onSubmit={async (event) => {
            event.preventDefault();
            if (pending) return;
            setError('');
            if (password !== confirm) {
              setError('两次输入的密码不一致。');
              return;
            }
            const bytes = new TextEncoder().encode(password).length;
            if (bytes < 12 || bytes > 72) {
              setError('密码需为 12 到 72 字节。');
              return;
            }
            setPending(true);
            try {
              await acceptInvitation(token, password);
              setPassword('');
              setConfirm('');
              setToken('');
              setDone(true);
            } catch (e) {
              setError(e instanceof Error ? e.message : '无法接受邀请，请联系管理员重新创建。');
            } finally {
              setPending(false);
            }
          }}
        >
          <p className="text-text-secondary">
            设置密码以接受邀请。链接有效期为 24 小时，仅可使用一次。
          </p>
          <PasswordField
            messages={{ showPassword: '显示密码', hidePassword: '隐藏密码' }}
            label="新密码"
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <PasswordField
            messages={{ showPassword: '显示密码', hidePassword: '隐藏密码' }}
            label="确认密码"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
          <Button type="submit" loading={pending}>
            接受邀请
          </Button>
        </form>
      )}
    </main>
  );
}
