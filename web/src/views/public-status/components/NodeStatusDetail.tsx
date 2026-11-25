import { RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ApiError } from '@/api/client';
import { nodeTime } from '@/api/nodes';
import {
  readHistory,
  type StatusHistory,
  type StatusHistoryRange,
  type StatusNode,
  type StatusPage,
} from '@/api/public-status';
import { Button } from '@/components/arc/button/button';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import { MetricTrendView } from '@/views/nodes/components/NodeMetricHistory';
import { stamp, statusRangeLabels } from '../format';
import { statusMetricCharts } from '../status-charts';
import DetailWorkspace from './DetailWorkspace';

const validRanges: StatusHistoryRange[] = ['1h', '6h', '24h', '2d', '7d'];
const rangeOptions = validRanges.map((value) => ({
  value,
  label: statusRangeLabels[value],
}));

export default function NodeStatusDetail({
  node,
  rates,
  snapshotAt,
  now,
}: {
  node: StatusNode;
  rates: StatusPage['rates'];
  snapshotAt: string;
  now: number;
}) {
  const [params, setParams] = useSearchParams();
  const requestedRange = params.get('range') ?? '1h';
  const range: StatusHistoryRange = validRanges.includes(requestedRange as StatusHistoryRange)
    ? (requestedRange as StatusHistoryRange)
    : '1h';

  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<{ range: StatusHistoryRange; data: StatusHistory } | null>(
    null,
  );
  const [, error] = useToastFeedback('error', 'status-history');

  // biome-ignore lint/correctness/useExhaustiveDependencies: retry triggers an explicit re-fetch and cancels its predecessor.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    readHistory(node.id, range, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setResult({ range, data });
        error('');
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiError && cause.status === 404) setResult(null);
        error(cause instanceof Error ? cause.message : '历史指标读取失败，请重试。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [node.id, range, retry, error]);

  const activeHistory = result?.range === range ? result.data : null;
  const charts = useMemo(() => statusMetricCharts(node, now), [node, now]);

  const handleRangeChange = (nextRange: string) => {
    const next = new URLSearchParams(params);
    next.set('range', nextRange);
    void setParams(next, { replace: true, preventScrollReset: true });
  };

  const historyStatusText = activeHistory
    ? `当前显示：${nodeTime(activeHistory.start)} 至 ${nodeTime(activeHistory.end)}。CPU 和内存为均值，网络、磁盘 IO 与连接数为峰值，负载和容量为最新值。`
    : loading
      ? '正在读取历史指标…'
      : '历史指标尚未读取。';

  return (
    <div className="min-w-0 space-y-5">
      {!node.online && (
        <div
          role="status"
          className="rounded-(--radius-control) border-[1px] border-warning/40 bg-surface-raised px-4 py-2.5 text-(length:--text-xs) text-text-secondary tabular-nums"
        >
          当前节点管理连接离线，以下展示最近一次有效采样与历史留存趋势
          {node.last_seen_at ? `（最后在线 ${stamp(node.last_seen_at)}）` : ''}。
        </div>
      )}

      <DetailWorkspace
        node={node}
        rates={rates}
        snapshotAt={snapshotAt}
        now={now}
        range={range}
        history={activeHistory}
      />

      <MetricTrendView
        title="资源历史趋势"
        headingLevel={2}
        range={range}
        onRangeChange={handleRangeChange}
        rangeOptions={rangeOptions}
        charts={charts}
        trends={activeHistory?.charts}
        loading={loading}
        loadingData={loading && !activeHistory}
        statusText={historyStatusText}
        gridClassName="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"
        action={
          <Button
            loading={loading}
            variant="secondary"
            onClick={() => setRetry((value) => value + 1)}
          >
            <RefreshCw size={16} aria-hidden="true" />
            刷新历史
          </Button>
        }
      />
    </div>
  );
}
