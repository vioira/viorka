import { Pause, Play, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ApiError } from '@/api/client';
import type { MetricTrends } from '@/api/metric-trends';
import { nodeTime } from '@/api/nodes';
import {
  readHistory,
  type StatusHistory,
  type StatusHistoryRange,
  type StatusNode,
  type StatusPage,
  statusHistoryRanges,
  statusObservationRange,
} from '@/api/public-status';
import { Button } from '@/components/arc/button/button';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import MetricTrend from '@/views/nodes/components/MetricTrend';
import { stamp, statusRangeLabels } from '../format';
import { statusMetricCharts } from '../status-charts';
import DetailWorkspace from './DetailWorkspace';
import LiveTelemetryStrip from './LiveTelemetryStrip';
import PublicTCPProbes from './PublicTCPProbes';

const rangeOptions = [
  { value: 'live', label: '实时' },
  ...statusHistoryRanges.map((value) => ({ value, label: statusRangeLabels[value] })),
];

const focusOptions = [
  { value: 'all', label: '全部' },
  { value: 'network', label: '网络与线路' },
  { value: 'system', label: '系统资源' },
];

export default function NodeStatusDetail({
  node,
  rates,
  snapshotAt,
  streamState,
  now,
}: {
  node: StatusNode;
  rates: StatusPage['rates'];
  snapshotAt: string;
  streamState: 'connected' | 'disconnected' | 'disabled';
  now: number;
}) {
  const [params, setParams] = useSearchParams();
  const range = statusObservationRange(params.get('range'));

  const live = range === 'live';
  const [frozen, setFrozen] = useState<{
    charts: ReturnType<typeof statusMetricCharts>;
    trends: MetricTrends;
  } | null>(null);
  useEffect(() => {
    if (!live || streamState === 'disabled') setFrozen(null);
  }, [live, streamState]);

  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [focus, setFocus] = useState<'all' | 'network' | 'system'>('all');
  const [result, setResult] = useState<{ range: StatusHistoryRange; data: StatusHistory } | null>(
    null,
  );
  const [, error] = useToastFeedback('error', 'status-history');

  // biome-ignore lint/correctness/useExhaustiveDependencies: retry triggers an explicit re-fetch and cancels its predecessor.
  useEffect(() => {
    if (range === 'live') return;
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
  const paused = live ? frozen : null;
  const trends = live ? (paused?.trends ?? node.metric_trends) : activeHistory?.charts;
  const currentCharts = useMemo(() => statusMetricCharts(node, now), [node, now]);
  const charts = paused?.charts ?? currentCharts;
  const chartMap = useMemo(() => new Map(charts.map((chart) => [chart.key, chart])), [charts]);

  const handleRangeChange = (nextRange: string) => {
    const next = new URLSearchParams(params);
    next.set('range', nextRange);
    void setParams(next, { replace: true, preventScrollReset: true });
  };

  const historyWindowText = activeHistory
    ? `${nodeTime(activeHistory.start)} 至 ${nodeTime(activeHistory.end)}`
    : loading
      ? '正在读取历史指标…'
      : '历史指标尚未读取';

  const liveWindowText = {
    connected: '最近 10 分钟，每项最多 120 个点',
    disconnected: '实时推送未连接',
    disabled: '实时推送已关闭',
  }[streamState];
  const loadingTrends = !live && loading && !activeHistory;
  const networkChart = chartMap.get('network');
  const cpuChart = chartMap.get('cpu');
  const systemCharts = ['memory', 'disk', 'disk_io', 'load', 'connections', 'processes']
    .map((key) => chartMap.get(key))
    .filter((chart): chart is NonNullable<typeof chart> => Boolean(chart));

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

      <LiveTelemetryStrip
        node={node}
        now={now}
        cpuPoints={(live ? node.metric_trends : activeHistory?.charts)?.cpu?.points}
      />

      <DetailWorkspace node={node} rates={rates} now={now} />

      <section aria-label="数据观测" aria-busy={!live && loading} className="space-y-4">
        <div className="v-card flex flex-wrap items-center justify-between gap-3 md:sticky md:top-3 md:z-20">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h2 className="v-card-title">数据观测</h2>
            <SegmentedControl
              label="观测时间范围"
              value={range}
              onValueChange={(value) => {
                if (value !== range) handleRangeChange(value);
              }}
              options={rangeOptions}
            />
            <span
              className="text-(length:--text-xs) text-text-secondary tabular-nums"
              role="status"
            >
              {live ? liveWindowText : historyWindowText}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              label="观测指标分组"
              value={focus}
              onValueChange={(value) => setFocus(value as 'all' | 'network' | 'system')}
              options={focusOptions}
            />
            {!live && (
              <Button
                loading={loading}
                variant="secondary"
                onClick={() => setRetry((value) => value + 1)}
              >
                <RefreshCw size={16} aria-hidden="true" />
                刷新历史
              </Button>
            )}
          </div>
        </div>

        {focus !== 'system' && (
          <PublicTCPProbes
            node={node}
            snapshotAt={snapshotAt}
            range={range}
            history={activeHistory}
          />
        )}

        <section aria-label="资源趋势" className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="v-card-title">资源趋势</h3>
            {live ? (
              <Button
                variant="ghost"
                disabled={!paused && !node.metric_trends}
                onClick={() => {
                  if (paused) setFrozen(null);
                  else if (node.metric_trends)
                    setFrozen({ charts: currentCharts, trends: node.metric_trends });
                }}
              >
                {paused ? (
                  <Play size={16} aria-hidden="true" />
                ) : (
                  <Pause size={16} aria-hidden="true" />
                )}
                {paused ? '恢复实时' : '暂停显示'}
              </Button>
            ) : (
              <p className="text-(length:--text-xs) text-text-secondary">
                CPU 和内存为均值，网络、磁盘 IO 与连接数为峰值，负载和容量为最新值。
              </p>
            )}
          </div>

          <div
            className={`grid min-w-0 grid-cols-1 gap-4 ${focus === 'all' ? 'lg:grid-cols-2' : ''}`}
          >
            {focus !== 'system' && networkChart && (
              <MetricTrend
                chart={networkChart}
                data={trends?.network}
                realtime={live}
                loading={loadingTrends}
              />
            )}
            {focus !== 'network' && cpuChart && (
              <MetricTrend
                chart={cpuChart}
                data={trends?.cpu}
                realtime={live}
                loading={loadingTrends}
              />
            )}
          </div>

          {focus !== 'network' && (
            <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-3">
              {systemCharts.map((chart) => (
                <MetricTrend
                  key={chart.key}
                  chart={chart}
                  data={trends?.[chart.key]}
                  realtime={live}
                  loading={loadingTrends}
                />
              ))}
            </div>
          )}
        </section>
      </section>
    </div>
  );
}
