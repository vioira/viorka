import { type FormEvent, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { login } from '@/api/auth';
import { Button } from '@/components/arc/button/button';
import { Input } from '@/components/arc/input/input';
import { PasswordField } from '@/components/arc/password-field/password-field';
import { useToastFeedback } from '@/hooks/use-toast-feedback';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [, setError] = useToastFeedback('error');
  const busy = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      await login(username, password);
      setPassword('');
      await navigate('/', { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登录未完成，请稍后重试。');
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-svh place-items-center bg-background bg-(image:--workspace-wash) p-4 font-ui text-foreground sm:p-8">
      <div className="grid w-full max-w-200 overflow-hidden rounded-[30px] border-[0.5px] border-border bg-(--surface) min-[800px]:grid-cols-2">
        <div className="flex flex-col bg-(image:--brand-panel) p-8 text-(--brand-ink) min-[800px]:min-h-130 min-[800px]:p-9">
          <div className="flex items-center gap-3 font-title text-(length:--text-xl) font-medium">
            <img src="/image/viorka.svg" alt="" width="40" height="40" />
            Viorka
          </div>
          <p className="mt-8 font-title text-(length:--text-2xl) leading-[1.35] font-medium">
            统一管理你的
            <br />
            节点与代理服务
          </p>
          <p className="mt-4 max-w-72 text-(length:--text-sm) leading-[1.8]">
            VPS、NAT VPS 与中转链路，一个控制面板。
          </p>
          <p className="mt-auto hidden pt-12 text-(length:--text-xs) min-[800px]:block">
            Viorka by Vioira
          </p>
        </div>
        <section
          className="flex min-w-0 flex-col justify-center p-8 min-[800px]:px-10 min-[800px]:py-11"
          aria-labelledby="login-title"
        >
          <div className="w-full">
            <h1
              id="login-title"
              className="m-0 font-title text-(length:--text-xl) leading-(--leading-display) font-medium tracking-(--tracking-display)"
            >
              登录 Viorka
            </h1>
            <p className="mt-2 mb-6 text-(length:--text-sm) leading-[1.7] wrap-anywhere text-text-secondary">
              登录控制台，管理你的节点与代理服务。
            </p>
            <form
              className="grid gap-6 [--control-height-md:52px]"
              onSubmit={submit}
              aria-busy={pending}
            >
              <Input
                label="用户名"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                maxLength={64}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                readOnly={pending}
              />
              <PasswordField
                label="密码"
                name="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                readOnly={pending}
                messages={{ showPassword: '显示密码', hidePassword: '隐藏密码' }}
              />
              <Button type="submit" variant="primary" loading={pending} className="w-full">
                {pending ? '正在登录…' : '登录控制台'}
              </Button>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
