import { useEffect, useState } from 'react';
import { type AlertNodeStatus, getAlertRuleStatus } from '@/api/alerts';
import { Button } from '@/components/arc/button/button';
import { Input } from '@/components/arc/input/input';
import { useToastFeedback } from '@/hooks/use-toast-feedback';

const labels: Record<string, string> = {
  insufficient: '数据不足',
  disabled: '规则已停用',
  high: '达到触发条件',
  normal: '正常',
  mixed: '窗口样本部分超阈值',
  waiting: '等待离线时长达到阈值',
  no_quota: '未设置额度',
};
export default function RuleStatus({ id }: { id: string }) {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<AlertNodeStatus[] | null>(null);
  const [next, setNext] = useState('');
  const [request, setRequest] = useState({ after: '' });
  const [busy, setBusy] = useState(false);
  const [, error] = useToastFeedback('error', 'notification-status');
  useEffect(() => {
    const ctl = new AbortController();
    setBusy(true);
    getAlertRuleStatus(id, request.after, ctl.signal)
      .then((v) => {
        if (!ctl.signal.aborted) {
          setItems((old) => (request.after ? [...(old ?? []), ...v.items] : v.items));
          setNext(v.next_cursor);
        }
      })
      .catch((e) => {
        if (!ctl.signal.aborted) error(e.message);
      })
      .finally(() => {
        if (!ctl.signal.aborted) setBusy(false);
      });
    return () => ctl.abort();
  }, [id, request, error]);
  const matches = items?.filter(
    (n) =>
      n.name.toLowerCase().includes(search.trim().toLowerCase()) || n.id.includes(search.trim()),
  );
  return (
    <section className="space-y-3">
      <Input
        label="筛选已加载的服务器"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => setRequest({ after: '' })}>
          刷新状态
        </Button>
      </div>
      {items === null ? (
        <p role="status">{busy ? '正在读取状态…' : '状态尚未读取'}</p>
      ) : !matches?.length ? (
        <p>暂无匹配的服务器</p>
      ) : (
        <ul className="divide-y divide-border">
          {matches.map((v) => (
            <li key={v.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span className="break-all">{v.name}</span>
              <span>
                {v.active ? '告警中，' : ''}
                {labels[v.state] ?? '未知'}
              </span>
            </li>
          ))}
        </ul>
      )}
      {next && (
        <Button variant="secondary" disabled={busy} onClick={() => setRequest({ after: next })}>
          加载更多服务器
        </Button>
      )}
    </section>
  );
}
