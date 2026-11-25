import { Pause, Play, RefreshCw } from 'lucide-react';
import { memo, type ReactNode, useEffect, useMemo, useState } from 'react';
import type { HistoryRange } from '@/api/metric-history';
import {
  type MetricTrendHistory,
  type MetricTrends,
  parseMetricTrendHistory,
} from '@/api/metric-trends';
import { nodeTime } from '@/api/nodes';
import { Button } from '@/components/arc/button/button';
import SegmentedControl, {
  type Segment,
} from '@/components/arc/segmented-control/segmented-control';
import { useBrowserView } from '@/hooks/use-browser-view';
import MetricTrend from './MetricTrend';
import type { MetricChart } from './metric-chart';

export type MetricRange = HistoryRange | 'live';

const defaultRangeOptions: Segment[] = [
  { value: 'live', label: '实时' },
  { value: '1h', label: '1 小时' },
  { value: '6h', label: '6 小时' },
  { value: '24h', label: '24 小时' },
  { value: '2d', label: '2 天' },
  { value: '7d', label: '7 天' },
];

export function MetricTrendView({
  title = '资源趋势',
  headingLevel = 3,
  range,
  onRangeChange,
  rangeOptions = defaultRangeOptions,
  charts,
  trends,
  realtime = false,
  loading = false,
  loadingData = false,
  statusText,
  action,
  compact = false,
  gridClassName,
  className = 'space-y-4 border-t-[1px] border-border pt-6',
}: {
  title?: string;
  headingLevel?: 2 | 3;
  range: string;
  onRangeChange: (range: string) => void;
  rangeOptions?: Segment[];
  charts: MetricChart[];
  trends?: MetricTrends;
  realtime?: boolean;
  loading?: boolean;
  loadingData?: boolean;
  statusText: string;
  action?: ReactNode;
  compact?: boolean;
  gridClassName?: string;
  className?: string;
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const displayedCharts = useMemo(
    () => charts.filter((c) => !c.key.startsWith('disk_io') || c.key === 'disk_io'),
    [charts],
  );
  return (
    <section aria-label={title} aria-busy={loading} className={className}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Heading className="font-medium">{title}</Heading>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-3">
          <SegmentedControl
            label="指标时间范围"
            value={range}
            onValueChange={(v) => {
              if (v !== range) onRangeChange(v);
            }}
            options={rangeOptions}
          />
        </div>
        {action && <div className="ml-auto flex shrink-0 justify-end">{action}</div>}
      </div>
      <p className="min-h-10 text-(length:--text-xs) text-text-secondary" role="status">
        {statusText}
      </p>
      <div
        className={
          gridClassName ??
          (compact
            ? 'grid min-w-0 grid-cols-1 gap-4'
            : 'grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4')
        }
      >
        {displayedCharts.map((chart) => (
          <MetricTrend
            key={chart.key}
            chart={chart}
            data={trends?.[chart.key]}
            realtime={realtime}
            loading={loadingData}
          />
        ))}
      </div>
    </section>
  );
}

function NodeMetricHistory({
  id,
  active,
  range,
  onRangeChange,
  compact = false,
  currentCharts,
  trends,
}: {
  id: string;
  active: boolean;
  range: MetricRange;
  onRangeChange: (range: MetricRange) => void;
  compact?: boolean;
  currentCharts?: MetricChart[];
  trends?: MetricTrends;
}) {
  const [frozen, setFrozen] = useState<{
    charts?: MetricChart[];
    trends?: MetricTrends;
  }>();
  const charts = useMemo(
    () =>
      (frozen ? (frozen.charts ?? []) : (currentCharts ?? [])).filter(
        (chart) => !compact || ['cpu', 'memory'].includes(chart.key),
      ),
    [compact, currentCharts, frozen],
  );
  const [result, setResult] = useState<{ data: MetricTrendHistory; range: HistoryRange }>();
  const [retry, setRetry] = useState(0);
  const { loading } = useBrowserView(
    'metric_trends',
    active && range !== 'live' ? { node: id, range } : null,
    retry,
    parseMetricTrendHistory,
    (data) => {
      if (range !== 'live') setResult({ data, range });
    },
    true,
  );
  useEffect(() => {
    if (active && range === 'live') setFrozen(undefined);
  }, [active, range]);
  const displayedRange = range === 'live' ? 'live' : result?.range;
  const data = range === 'live' ? (frozen ? frozen.trends : trends) : result?.data.charts;
  const statusText =
    range === 'live'
      ? `${frozen ? '显示已暂停。' : ''}最近 10 分钟，最多 120 个点，按采样点等距排列。`
      : result
        ? `当前显示：${nodeTime(result.data.start)} 至 ${nodeTime(result.data.end)}。CPU 和内存为均值，网络、磁盘 IO 与连接数为峰值，负载和容量为最新值。`
        : loading
          ? '正在读取历史指标…'
          : '历史指标尚未读取。';
  return (
    <MetricTrendView
      title="资源趋势"
      range={range}
      onRangeChange={(v) => {
        setFrozen(undefined);
        onRangeChange(v as MetricRange);
      }}
      charts={charts}
      trends={data}
      realtime={displayedRange === 'live'}
      loading={range !== 'live' && loading}
      loadingData={range !== 'live' && loading && (range !== displayedRange || !result)}
      statusText={statusText}
      compact={compact}
      action={
        range === 'live' ? (
          <Button
            variant="ghost"
            onClick={() =>
              setFrozen(
                frozen
                  ? undefined
                  : {
                      charts: currentCharts,
                      trends,
                    },
              )
            }
          >
            {frozen ? (
              <Play size={16} aria-hidden="true" />
            ) : (
              <Pause size={16} aria-hidden="true" />
            )}
            {frozen ? '恢复实时' : '暂停显示'}
          </Button>
        ) : (
          <Button
            loading={loading}
            variant="secondary"
            onClick={() => {
              setRetry((n) => n + 1);
            }}
          >
            <RefreshCw size={16} aria-hidden="true" />
            刷新历史
          </Button>
        )
      }
    />
  );
}

// Parent clocks update freshness text, not unchanged chart data.
export default memo(NodeMetricHistory);
