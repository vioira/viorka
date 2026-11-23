import { CircleAlert, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type AlertNodeStatus, getAlertRuleStatus } from '@/api/alerts';
import { Button } from '@/components/arc/button/button';
import { SearchField } from '@/components/arc/search-field/search-field';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import DataTable, { type DataColumn } from '@/components/data-table';
import { useToastFeedback } from '@/hooks/use-toast-feedback';

const judgments: Record<string, { label: string; dot: string }> = {
  normal: { label: '正常', dot: 'bg-(--status-positive-text)' },
  high: { label: '达到触发条件', dot: 'bg-(--status-negative-text)' },
  mixed: { label: '窗口内部分样本超阈值', dot: 'bg-(--status-warning-text)' },
  no_quota: { label: '未设置额度', dot: 'bg-(--status-warning-text)' },
  waiting: { label: '离线时长未达阈值', dot: 'bg-(--status-information-text)' },
  insufficient: { label: '数据不足', dot: 'bg-(--icon-disabled)' },
  disabled: { label: '规则已停用', dot: 'bg-(--icon-disabled)' },
};

function CurrentJudgment({ state }: { state: string }) {
  const { label, dot } = Object.hasOwn(judgments, state)
    ? judgments[state]
    : { label: '未知', dot: 'bg-(--icon-disabled)' };
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function AlertState({ active }: { active: boolean }) {
  return active ? (
    <span className="inline-flex items-center gap-1 text-(--status-negative-text)">
      <CircleAlert size={14} aria-hidden="true" />
      告警中
    </span>
  ) : (
    <span className="text-text-secondary">无活动告警</span>
  );
}

const columns: DataColumn<AlertNodeStatus>[] = [
  {
    key: 'name',
    label: '节点',
    width: '40%',
    sortable: false,
    render: (_, node) => <span className="[overflow-wrap:anywhere]">{node.name}</span>,
  },
  {
    key: 'active',
    label: '告警状态',
    width: '24%',
    sortable: false,
    render: (_, node) => <AlertState active={node.active} />,
  },
  {
    key: 'state',
    label: '当前判定',
    sortable: false,
    render: (_, node) => <CurrentJudgment state={node.state} />,
  },
];

export default function RuleStatus({ id }: { id: string }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [items, setItems] = useState<AlertNodeStatus[] | null>(null);
  const [next, setNext] = useState('');
  const [request, setRequest] = useState({ after: '' });
  const [busy, setBusy] = useState(true);
  const [, error] = useToastFeedback('error', 'notification-status');

  useEffect(() => {
    const ctl = new AbortController();
    setBusy(true);
    getAlertRuleStatus(id, request.after, ctl.signal)
      .then((v) => {
        if (!ctl.signal.aborted) {
          setItems((old) => (request.after ? [...(old ?? []), ...v.items] : v.items));
          setNext(v.next_cursor);
          error('');
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

  const query = search.trim().toLowerCase();
  const activeCount = items?.filter((node) => node.active).length;
  const rows = (items ?? [])
    .filter((node) => filter === 'all' || node.active)
    .filter(
      (node) => node.name.toLowerCase().includes(query) || node.id.toLowerCase().includes(query),
    )
    .sort((a, b) => Number(b.active) - Number(a.active));
  const emptyMessage = !items?.length
    ? '规则范围内暂无节点'
    : query
      ? '已加载节点中无匹配结果'
      : '已加载节点中无活动告警';

  return (
    <section aria-labelledby="rule-status-nodes" className="min-w-0 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 id="rule-status-nodes" className="font-medium text-foreground">
          节点状态
        </h3>
        <Button variant="secondary" disabled={busy} onClick={() => setRequest({ after: '' })}>
          <RefreshCw size={16} aria-hidden="true" />
          刷新状态
        </Button>
      </div>
      <SegmentedControl
        label="按告警状态筛选已加载节点"
        className="max-w-full tabular-nums"
        value={filter}
        onValueChange={setFilter}
        options={[
          { value: 'all', label: items ? `全部 ${items.length}` : '全部' },
          {
            value: 'active',
            label: activeCount === undefined ? '告警中' : `告警中 ${activeCount}`,
          },
        ]}
      />
      <SearchField
        hideLabel
        label="搜索已加载节点的名称或 ID"
        placeholder="搜索已加载节点的名称或 ID"
        value={search}
        onValueChange={setSearch}
      />
      {rows.length > 0 && (
        <ul
          aria-label="节点状态"
          aria-busy={busy}
          className="divide-y divide-border border-y border-border md:hidden"
        >
          {rows.map((node) => (
            <li key={node.id} className="space-y-1 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{node.name}</span>
                <span className="shrink-0">
                  <AlertState active={node.active} />
                </span>
              </div>
              <p className="flex gap-2 text-text-secondary">
                <span>当前判定</span>
                <CurrentJudgment state={node.state} />
              </p>
            </li>
          ))}
        </ul>
      )}
      <div className={rows.length ? 'hidden md:block' : undefined}>
        <DataTable
          caption="节点状态"
          rows={rows}
          rowKey="id"
          columns={columns}
          loading={busy}
          loaded={items !== null}
          emptyMessage={emptyMessage}
          emptyState={{ variant: items?.length ? 'no-results' : 'empty' }}
        />
      </div>
      {next && (
        <div className="flex items-center justify-between gap-3">
          <span role="status" className="text-text-secondary tabular-nums">
            已加载 {items?.length} 台
          </span>
          <Button variant="secondary" disabled={busy} onClick={() => setRequest({ after: next })}>
            加载更多节点
          </Button>
        </div>
      )}
    </section>
  );
}
