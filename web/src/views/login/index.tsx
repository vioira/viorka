import { type FormEvent, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { login } from '@/api/auth';
import { Button } from '@/components/arc/button/button';
import { Input } from '@/components/arc/input/input';
import { PasswordField } from '@/components/arc/password-field/password-field';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
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
    <main className="grid min-h-svh grid-cols-1 gap-3 bg-background p-6 font-ui text-foreground min-[800px]:grid-cols-2 min-[800px]:p-3">
      <div
        className="relative hidden min-w-0 overflow-hidden rounded-(--radius-surface) bg-surface-muted min-[800px]:block"
        aria-hidden="true"
      >
        {/* <img
          className="absolute size-full object-cover object-[56%_center]"
          src="/image/Viorka-login-background-1920x1080.webp"
          alt=""
        /> */}
      </div>
      <section
        className="grid min-w-0 grid-rows-[auto_1fr_auto] min-[800px]:px-8 min-[800px]:py-6 min-[1025px]:px-12"
        aria-labelledby="login-title"
      >
        <header className="flex items-center gap-3 text-(length:--text-xl) font-medium">
          <img src="/image/viorka.svg" alt="" width="32" height="28" />
          <span>Viorka</span>
        </header>
        <div className="m-auto w-full max-w-100 py-12 min-[800px]:py-16">
          <h1
            id="login-title"
            className="m-0 font-title text-(length:--text-3xl) leading-(--leading-display) font-medium tracking-(--tracking-display)"
          >
            登录 Viorka
          </h1>
          <p className="mt-4 mb-10 text-(length:--text-sm) leading-[1.7] wrap-anywhere text-text-secondary">
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
          <div className="mt-3 min-h-6" aria-live="polite">
            {error && (
              <p role="alert" className="m-0 text-(length:--text-sm) leading-[1.6] text-danger">
                {error}
              </p>
            )}
          </div>
          <p className="m-0 text-center text-(length:--text-sm) leading-[1.7] text-text-secondary">
            账号由管理员分配。需要帮助？请联系实例管理员。
          </p>
        </div>
        <footer className="text-center text-(length:--text-xs) text-text-secondary">
          Viorka 控制台
        </footer>
      </section>
    </main>
  );
}
