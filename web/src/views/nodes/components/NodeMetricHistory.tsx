import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  getMetricHistory,
  type HistoryRange,
  type MetricHistory,
  rangeSeconds,
} from '@/api/metric-history';
import { nodeTime } from '@/api/nodes';
import { LIVE_POINT_LIMIT, type LivePoint } from '@/api/realtime';
import { Button } from '@/components/arc/button/button';
import { motionTokens } from '@/components/arc/lib/motion-tokens';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { useChangeVersion } from '@/hooks/realtime';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import MetricTrend from './MetricTrend';
import { historyMetricCharts, type MetricChart } from './metric-chart';

const emptyPoints: LivePoint[] = [];

function NodeMetricHistory({
  id,
  active,
  compact = false,
  points,
  currentCharts,
}: {
  id: string;
  active: boolean;
  compact?: boolean;
  points?: LivePoint[];
  currentCharts?: MetricChart[];
}) {
  const eventVersion = useChangeVersion('history', id);
  const [frozen, setFrozen] = useState<{
    points: LivePoint[];
    charts?: MetricChart[];
  }>();
  const charts = useMemo(
    () =>
      (frozen ? (frozen.charts ?? []) : (currentCharts ?? [])).filter(
        (chart) => !compact || ['cpu', 'memory'].includes(chart.key),
      ),
    [compact, currentCharts, frozen],
  );
  const [range, setRange] = useState<HistoryRange | 'live'>(compact ? '24h' : 'live');
  const [displayedRange, setDisplayedRange] = useState<HistoryRange | 'live'>(range);
  const [result, setResult] = useState<{ data: MetricHistory; range: HistoryRange; end: number }>();
  const [loading, setLoading] = useState(true);
  const transitionUntil = useRef(0);
  const [retry, setRetry] = useState(0);
  const [statistic, setStatistic] = useState<'mean' | 'max'>('mean');
  const [, report] = useToastFeedback('error');
  useEffect(() => {
    void eventVersion; // A committed change invalidates this read.
    void retry;
    if (!active || range === 'live') return;
    const controller = new AbortController();
    let finishDelay: () => void = () => {};
    let delayTimer: ReturnType<typeof setTimeout> | undefined;
    const minimumLoading = new Promise<void>((resolve) => {
      finishDelay = resolve;
      const remaining = transitionUntil.current - performance.now();
      if (remaining > 0) delayTimer = setTimeout(resolve, remaining);
      else resolve();
    });
    const load = async () => {
      setLoading(true);
      try {
        const data = await getMetricHistory(id, range, controller.signal);
        const end = Date.now();
        await minimumLoading;
        if (!controller.signal.aborted) {
          setResult({ data, range, end });
          setDisplayedRange(range);
          report('');
        }
      } catch (e) {
        await minimumLoading;
        if (!controller.signal.aborted)
          report(e instanceof Error ? e.message : '历史指标读取失败，请刷新重试。');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      controller.abort();
      clearTimeout(delayTimer);
      finishDelay();
    };
  }, [id, active, range, retry, report, eventVersion]);
  const livePoints = frozen ? frozen.points : (points ?? emptyPoints);
  const data = displayedRange === 'live' ? undefined : result?.data;
  const displayedCharts = useMemo(
    () =>
      (displayedRange === 'live' || compact ? charts : historyMetricCharts(charts, data)).filter(
        (c) => !c.key.startsWith('disk_io') || c.key === 'disk_io',
      ),
    [charts, data, displayedRange, compact],
  );
  const end = result?.end ?? 0;
  const start = end - rangeSeconds[result?.range ?? (range === 'live' ? '1h' : range)] * 1000;
  return (
    <section
      aria-label="资源趋势"
      aria-busy={range !== 'live' && loading}
      className="space-y-4 border-t-[1px] border-border pt-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">资源趋势</h3>
        {range === 'live' ? (
          <Button
            variant="ghost"
            className="min-h-11"
            onClick={() =>
              setFrozen(frozen ? undefined : { points: points ?? [], charts: currentCharts })
            }
          >
            {frozen ? '恢复实时' : '暂停显示'}
          </Button>
        ) : (
          <Button variant="ghost" className="min-h-11" onClick={() => setRetry((n) => n + 1)}>
            刷新历史
          </Button>
        )}
      </div>
      <SegmentedControl
        label="指标时间范围"
        className="[--control-height-sm:44px]"
        value={range}
        onValueChange={(v) => {
          if (v === range) return;
          transitionUntil.current =
            v === 'live' ? 0 : performance.now() + motionTokens.duration.standard * 1000;
          setFrozen(undefined);
          setRange(v as HistoryRange | 'live');
          if (v === 'live') setDisplayedRange('live');
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
      {range !== 'live' && !data?.typed && (
        <SegmentedControl
          label="历史统计方式"
          className="[--control-height-sm:44px]"
          value={statistic}
          onValueChange={(v) => setStatistic(v as 'mean' | 'max')}
          options={[
            { value: 'mean', label: '平均值' },
            { value: 'max', label: '峰值' },
          ]}
        />
      )}
      <p className="min-h-10 text-(length:--text-xs) text-text-secondary" role="status">
        {range === 'live'
          ? `${frozen ? '显示已暂停。' : ''}最近 10 分钟，保留原始采样，最多 ${LIVE_POINT_LIMIT} 点，重新进入不压成均值；缺失不补零。`
          : result
            ? `当前显示：${nodeTime(new Date(start).toISOString())} 至 ${nodeTime(new Date(end).toISOString())}，每 ${result.data.period_seconds} 秒汇总。${data?.typed ? 'CPU 和内存为采样均值，网络、磁盘 IO 与连接数为采样峰值，负载和容量为最新值' : `曲线为${statistic === 'max' ? '采样峰值' : '采样平均值'}`}，卡片顶部为当前有效采样。历史保留 7 天。`
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
            statistic={statistic}
            data={data}
            window={displayedRange !== 'live' && result ? { start, end } : undefined}
            loading={range !== 'live' && loading && (range !== displayedRange || !result)}
            livePoints={displayedRange === 'live' ? livePoints : undefined}
          />
        ))}
      </div>
    </section>
  );
}

// Parent clocks update freshness text, not unchanged chart data.
export default memo(NodeMetricHistory);
