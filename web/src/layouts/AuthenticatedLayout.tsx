import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLoaderData, useNavigate } from 'react-router';
import { logout } from '@/api/auth';
import { ApiError } from '@/api/client';
import { getSettings, type SettingsResponse } from '@/api/settings';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import PanelLayout from '@/layouts/PanelLayout';
import type { requireSession } from '@/router/auth-loaders';

export default function AuthenticatedLayout() {
  const { toast, dismiss } = useToastStack();
  const session = useLoaderData<typeof requireSession>();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useToastFeedback('error');
  const [panelSettings, updateSettings] = useState<SettingsResponse | null>(null);
  const [settingsError, setSettingsError] = useState('');
  const reloadSettings = useCallback(async () => {
    setSettingsError('');
    try {
      updateSettings(await getSettings());
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : '无法读取面板设置，请重试。');
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    getSettings(controller.signal)
      .then(updateSettings)
      .catch((error) => {
        if (!controller.signal.aborted)
          setSettingsError(error instanceof Error ? error.message : '无法读取面板设置，请重试。');
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (settingsError)
      toast({
        id: 'panel-settings',
        type: 'error',
        title: '无法读取面板设置',
        description: settingsError,
        action: { label: '重新加载', onClick: () => void reloadSettings() },
      });
    else dismiss('panel-settings');
  }, [settingsError, toast, dismiss, reloadSettings]);

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
      panelName={panelSettings?.settings.panel_name}
      defaultTheme={panelSettings?.settings.theme}
      realtime={panelSettings?.settings.sse ?? false}
      username={session.user.username}
      role={session.user.role}
      pending={pending}
      onSignOut={signOut}
    >
      <Outlet
        context={{ ...session, panelSettings, settingsError, reloadSettings, updateSettings }}
      />
    </PanelLayout>
  );
}
