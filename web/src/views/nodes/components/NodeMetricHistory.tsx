import { Pause, Play, RefreshCw } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import type { HistoryRange } from '@/api/metric-history';
import {
  type MetricTrendHistory,
  type MetricTrends,
  parseMetricTrendHistory,
} from '@/api/metric-trends';
import { nodeTime } from '@/api/nodes';
import { Button } from '@/components/arc/button/button';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { useBrowserView } from '@/hooks/use-browser-view';
import MetricTrend from './MetricTrend';
import type { MetricChart } from './metric-chart';

export type MetricRange = HistoryRange | 'live';

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
  const displayedCharts = charts.filter((c) => !c.key.startsWith('disk_io') || c.key === 'disk_io');
  return (
    <section
      aria-label="资源趋势"
      aria-busy={range !== 'live' && loading}
      className="space-y-4 border-t-[1px] border-border pt-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">资源趋势</h3>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-3">
          <SegmentedControl
            label="指标时间范围"
            value={range}
            onValueChange={(v) => {
              if (v === range) return;
              setFrozen(undefined);
              onRangeChange(v as MetricRange);
            }}
            options={[
              { value: 'live', label: '实时' },
              { value: '1h', label: '1 小时' },
              { value: '6h', label: '6 小时' },
              { value: '24h', label: '24 小时' },
              { value: '2d', label: '2 天' },
              { value: '7d', label: '7 天' },
            ]}
          />
        </div>
        <div className="ml-auto flex shrink-0 justify-end">
          {range === 'live' ? (
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
          )}
        </div>
      </div>
      <p className="min-h-10 text-(length:--text-xs) text-text-secondary" role="status">
        {range === 'live'
          ? `${frozen ? '显示已暂停。' : ''}最近 10 分钟，最多 120 个点，按采样点等距排列。`
          : result
            ? `当前显示：${nodeTime(result.data.start)} 至 ${nodeTime(result.data.end)}。CPU 和内存为均值，网络、磁盘 IO 与连接数为峰值，负载和容量为最新值。`
            : loading
              ? '正在读取历史指标…'
              : '历史指标尚未读取。'}
      </p>
      <div
        className={
          compact
            ? 'grid min-w-0 grid-cols-1 gap-4'
            : 'grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4'
        }
      >
        {displayedCharts.map((chart) => (
          <MetricTrend
            key={chart.key}
            chart={chart}
            data={data?.[chart.key]}
            realtime={displayedRange === 'live'}
            loading={range !== 'live' && loading && (range !== displayedRange || !result)}
          />
        ))}
      </div>
    </section>
  );
}

// Parent clocks update freshness text, not unchanged chart data.
export default memo(NodeMetricHistory);
