import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@/api/auth';
import { applyNotificationDelta, parseNotificationEvent } from '@/api/notification-events';
import {
  listNotifications,
  markNotificationsRead,
  type Notification,
  setNotificationRead,
} from '@/api/settings';
import { NotificationCenter } from '@/components/arc/notification-center/notification-center';
import { useServerEvent } from '@/hooks/realtime';
import { useToastFeedback } from '@/hooks/use-toast-feedback';

export default function Notifications({
  realtime,
  session,
}: {
  realtime: boolean;
  session: Session;
}) {
  const [items, setItems] = useState<Notification[]>([]);
  const [, setError] = useToastFeedback('error');
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const updateVersion = useRef(0);
  const request = useRef<AbortController | null>(null);
  // Ignore in-flight SSE snapshots of a row while its write is being committed.
  const pending = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const version = ++updateVersion.current;
    setLoading(true);
    try {
      const response = await listNotifications(controller.signal);
      const value = parseNotificationEvent(JSON.stringify(response), true);
      if (version === updateVersion.current) {
        setItems(value.items);
        setLoaded(true);
        setError('');
      }
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : '无法读取通知，请刷新通知重试。');
    } finally {
      if (request.current === controller) setLoading(false);
    }
  }, [setError]);

  useEffect(() => {
    void refresh();
    return () => request.current?.abort();
  }, [refresh]);

  useServerEvent((event) => {
    if (!realtime || (event.type !== 'snapshot' && event.type !== 'notifications')) return;
    const receive = (data: string, snapshot: boolean) => {
      try {
        const value = parseNotificationEvent(data, snapshot);
        updateVersion.current += 1;
        setItems((current) => {
          const next = applyNotificationDelta(snapshot ? [] : current, value);
          return next.map((item) =>
            pending.current.has(item.id)
              ? (current.find((old) => old.id === item.id) ?? item)
              : item,
          );
        });
        setLoaded(true);
        setError('');
      } catch {
        setError('通知响应无效，请刷新通知重试。');
      }
    };
    receive(event.data, event.type === 'snapshot');
  });

  async function changeRead(id: string, read: boolean) {
    pending.current.add(id);
    ++updateVersion.current;
    try {
      await setNotificationRead(session, id, read);
      ++updateVersion.current;
      setItems((current) => current.map((item) => (item.id === id ? { ...item, read } : item)));
      setError('');
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '未能保存通知状态，请重试。');
      return false;
    } finally {
      pending.current.delete(id);
    }
  }

  async function markAllRead(ids: string[]) {
    if (ids.length === 0) return true;
    for (const id of ids) pending.current.add(id);
    ++updateVersion.current;
    try {
      await markNotificationsRead(session, ids);
      ++updateVersion.current;
      const selected = new Set(ids);
      setItems((current) =>
        current.map((item) => (selected.has(item.id) ? { ...item, read: true } : item)),
      );
      setError('');
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '未能批量标记已读，请刷新通知后重试。');
      return false;
    } finally {
      for (const id of ids) pending.current.delete(id);
    }
  }

  return (
    <NotificationCenter
      controlled
      label="通知"
      busy={loading}
      status={!loaded ? (loading ? '正在读取通知…' : '通知尚未读取') : undefined}
      notifications={items.map((item) => ({
        id: item.id,
        title: '节点离线',
        description: `${item.message}\n节点：${item.node_id}\n时间：${new Date(item.created_at).toLocaleString('zh-CN')}`,
        time: new Date(item.created_at).toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        read: item.read,
        tone: 'warning',
      }))}
      onMarkAllRead={(unread) => markAllRead(unread.map((item) => item.id))}
      onReadChange={(item, read) => changeRead(item.id, read)}
      onRefresh={() => void refresh()}
      onOpenChange={(open) => {
        if (open) void refresh();
      }}
    />
  );
}
