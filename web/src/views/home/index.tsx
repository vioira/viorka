import { useState } from 'react';
import { useLoaderData, useNavigate } from 'react-router';
import { logout } from '@/api/auth';
import { ApiError } from '@/api/client';
import PanelLayout from '@/layouts/PanelLayout';
import type { requireSession } from '@/router/auth-loaders';
import Overview from './components/Overview';

export default function HomePage() {
  const session = useLoaderData<typeof requireSession>();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function signOut() {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      await logout(session);
      await navigate('/login', { replace: true });
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        await navigate('/login', { replace: true });
      } else {
        setError(cause instanceof Error ? cause.message : '退出未完成，请稍后重试。');
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <PanelLayout
      username={session.user.username}
      role={session.user.role}
      pending={pending}
      error={error}
      onSignOut={signOut}
    >
      <Overview />
    </PanelLayout>
  );
}
