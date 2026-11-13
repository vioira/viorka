import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { HistoryRange } from '@/api/metric-history';
import { getMetricTrends, type MetricTrendHistory, type MetricTrends } from '@/api/metric-trends';
import { nodeTime } from '@/api/nodes';
import { Button } from '@/components/arc/button/button';
import { motionTokens } from '@/components/arc/lib/motion-tokens';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { useServerEvent } from '@/hooks/realtime';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import MetricTrend from './MetricTrend';
import type { MetricChart } from './metric-chart';

function NodeMetricHistory({
  id,
  active,
  onHistoryModeChange,
  compact = false,
  currentCharts,
  trends,
}: {
  id: string;
  active: boolean;
  onHistoryModeChange?: (history: boolean) => void;
  compact?: boolean;
  currentCharts?: MetricChart[];
  trends?: MetricTrends;
}) {
  const [range, setRange] = useState<HistoryRange | 'live'>(compact ? '24h' : 'live');
  const [eventVersion, setEventVersion] = useState(0);
  const historyDirty = useRef(false);
  const cache = useRef(new Map<HistoryRange, { data: MetricTrendHistory; range: HistoryRange }>());
  useServerEvent(
    (event) => {
      if (
        event.type === 'ready' ||
        (event.type === 'change' && event.change.kind === 'history' && event.change.node_id === id)
      )
        historyDirty.current = true;
    },
    active && range !== 'live' ? [{ kind: 'history', node_id: id }] : [],
  );
  useEffect(() => {
    if (!active || range === 'live') cache.current.clear();
  }, [active, range]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (historyDirty.current && !document.hidden) {
        historyDirty.current = false;
        cache.current.clear();
        setEventVersion((n) => n + 1);
      }
    }, 30_000);
    return () => clearInterval(timer);
  }, [active]);
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
  const [displayedRange, setDisplayedRange] = useState<HistoryRange | 'live'>(range);
  const [result, setResult] = useState<{ data: MetricTrendHistory; range: HistoryRange }>();
  const [loading, setLoading] = useState(true);
  const transitionUntil = useRef(0);
  const [retry, setRetry] = useState(0);
  const [, report] = useToastFeedback('error');
  useEffect(() => {
    if (active && range === 'live') setFrozen(undefined);
  }, [active, range]);

  useEffect(() => {
    void eventVersion; // A committed change invalidates this read.
    void retry;
    if (!active || range === 'live') return;
    const cached = cache.current.get(range);
    if (cached) {
      setResult(cached);
      setDisplayedRange(range);
      setLoading(false);
      return;
    }
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
        const data = await getMetricTrends(id, range, controller.signal);
        await minimumLoading;
        if (!controller.signal.aborted) {
          const entry = { data, range };
          cache.current.set(range, entry);
          setResult(entry);
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
  const data = displayedRange === 'live' ? (frozen ? frozen.trends : trends) : result?.data.charts;
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
              transitionUntil.current =
                v === 'live' ? 0 : performance.now() + motionTokens.duration.standard * 1000;
              setFrozen(undefined);
              setRange(v as HistoryRange | 'live');
              onHistoryModeChange?.(v !== 'live');
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
              {frozen ? '恢复实时' : '暂停显示'}
            </Button>
          ) : (
            <Button
              variant="ghost"
              onClick={() => {
                cache.current.clear();
                setRetry((n) => n + 1);
              }}
            >
              刷新历史
            </Button>
          )}
        </div>
      </div>
      <p className="min-h-10 text-(length:--text-xs) text-text-secondary" role="status">
        {range === 'live'
          ? `${frozen ? '显示已暂停。' : ''}最近 10 分钟，最多 120 个点。缺失采样显示为空。`
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
