import { Bell } from 'lucide-react';
import { useEffect, useState } from 'react';
import { listNotifications, type Notification } from '@/api/settings';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
export default function Notifications({ realtime }: { realtime: boolean }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [error, setError] = useToastFeedback('error');
  const [loading, setLoading] = useState(false);
  async function refresh() {
    setLoading(true);
    setError('');
    try {
      setItems((await listNotifications()).items);
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法读取通知，请重试。');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (!realtime) return;
    const stream = new EventSource('/api/v1/events');
    stream.addEventListener('snapshot', (event) => {
      try {
        const value = JSON.parse(event.data);
        if (Array.isArray(value.items)) {
          setItems(value.items);
          setError('');
        }
      } catch {
        setError('通知响应无效，请刷新重试。');
      }
    });
    stream.onerror = () => {
      stream.close();
      setError('实时通知连接中断，请刷新查看最新通知。');
    };
    return () => stream.close();
  }, [realtime, setError]);
  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) void refresh();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" aria-label={items.length ? `通知，${items.length} 条` : '通知'}>
          <Bell size={18} aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent title="通知" description="最近的节点离线告警，最多保留 100 条。">
        <div className="space-y-4">
          {loading && <p role="status">正在加载通知…</p>}

          {!loading && !error && items.length === 0 && (
            <p className="text-text-secondary">暂无告警通知</p>
          )}
          <ul className="space-y-4">
            {items.map((item) => (
              <li key={item.id}>
                <p>{item.message}</p>
                <p className="mt-1 break-all text-(length:--text-xs) text-text-secondary">
                  {item.node_id}
                </p>
                <time
                  className="text-(length:--text-xs) text-text-secondary"
                  dateTime={item.created_at}
                >
                  {new Date(item.created_at).toLocaleString('zh-CN')}
                </time>
              </li>
            ))}
          </ul>
          <Button variant="secondary" loading={loading} onClick={refresh}>
            刷新通知
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
