import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  getMetricHistory,
  type HistoryRange,
  type MetricHistory,
  rangeSeconds,
} from '@/api/metric-history';
import { nodeTime } from '@/api/nodes';
import type { LivePoint } from '@/api/realtime';
import { Button } from '@/components/arc/button/button';
import { motionTokens } from '@/components/arc/lib/motion-tokens';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { useServerEvent } from '@/hooks/realtime';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import MetricTrend from './MetricTrend';
import { historyMetricCharts, type MetricChart } from './metric-chart';

const emptyPoints: LivePoint[] = [];

function NodeMetricHistory({
  id,
  active,
  connectionState,
  onHistoryModeChange,
  compact = false,
  points,
  currentCharts,
}: {
  id: string;
  active: boolean;
  connectionState?: string;
  onHistoryModeChange?: (history: boolean) => void;
  compact?: boolean;
  points?: LivePoint[];
  currentCharts?: MetricChart[];
}) {
  const [range, setRange] = useState<HistoryRange | 'live'>(compact ? '24h' : 'live');
  const [eventVersion, setEventVersion] = useState(0);
  const historyDirty = useRef(false);
  const cache = useRef(
    new Map<HistoryRange, { data: MetricHistory; range: HistoryRange; end: number }>(),
  );
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
    points: LivePoint[];
    charts?: MetricChart[];
    history?: MetricHistory;
    end: number;
  }>();
  const charts = useMemo(
    () =>
      (frozen ? (frozen.charts ?? []) : (currentCharts ?? [])).filter(
        (chart) => !compact || ['cpu', 'memory'].includes(chart.key),
      ),
    [compact, currentCharts, frozen],
  );
  const [displayedRange, setDisplayedRange] = useState<HistoryRange | 'live'>(range);
  const [result, setResult] = useState<{ data: MetricHistory; range: HistoryRange; end: number }>();
  const [loading, setLoading] = useState(true);
  const transitionUntil = useRef(0);
  const [retry, setRetry] = useState(0);
  const [statistic, setStatistic] = useState<'mean' | 'max'>('mean');
  const [, report] = useToastFeedback('error');
  const [, reportLiveHistory] = useToastFeedback('error');
  const [liveSince, setLiveSince] = useState(Infinity);
  const [liveHistory, setLiveHistory] = useState<{ data: MetricHistory; end: number }>();
  useEffect(() => {
    void id; // A different node starts a new history/live boundary.
    if (!active || range !== 'live') return;
    setLiveSince((previous) => (Number.isFinite(previous) ? previous : Date.now()));
    setFrozen(undefined);
  }, [id, active, range]);
  const liveLoaded = useRef(false);
  const disconnected = useRef(false);
  const [gapVersion, setGapVersion] = useState(0);
  useEffect(() => {
    if (
      liveLoaded.current &&
      ['reconnecting', 'paused', 'disabled', 'closed'].includes(connectionState ?? '')
    )
      disconnected.current = true;
    if (connectionState === 'live' && disconnected.current) {
      disconnected.current = false;
      liveLoaded.current = false;
      setGapVersion((n) => n + 1);
    }
  }, [connectionState]);
  useEffect(() => {
    void gapVersion;
    if (!active || range !== 'live' || liveLoaded.current) return;
    const controller = new AbortController();
    void getMetricHistory(id, '10m', controller.signal).then(
      (data) => {
        if (controller.signal.aborted) return;
        liveLoaded.current = true;
        setLiveHistory({ data, end: Date.now() });
        reportLiveHistory('');
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          reportLiveHistory(
            error instanceof Error ? error.message : '历史指标读取失败，请刷新重试。',
          );
      },
    );
    return () => controller.abort();
  }, [id, active, range, gapVersion, reportLiveHistory]);
  const incomingPoints = useMemo(
    () => (points ?? emptyPoints).filter((point) => Date.parse(point.at) >= liveSince),
    [points, liveSince],
  );
  const liveEnd = Math.max(
    liveHistory?.end ?? 0,
    ...incomingPoints.map((point) => Date.parse(point.at)),
  );

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
        const data = await getMetricHistory(id, range, controller.signal);
        const end = Date.now();
        await minimumLoading;
        if (!controller.signal.aborted) {
          const entry = { data, range, end };
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
  const livePoints = frozen ? frozen.points : incomingPoints;
  const data =
    displayedRange === 'live' ? (frozen ? frozen.history : liveHistory?.data) : result?.data;
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
          {range !== 'live' && !data?.typed && (
            <SegmentedControl
              label="历史统计方式"
              value={statistic}
              onValueChange={(v) => setStatistic(v as 'mean' | 'max')}
              options={[
                { value: 'mean', label: '平均值' },
                { value: 'max', label: '峰值' },
              ]}
            />
          )}
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
                        points: incomingPoints,
                        charts: currentCharts,
                        history: liveHistory?.data,
                        end: liveEnd,
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
          ? `${frozen ? '显示已暂停。' : ''}最近 10 分钟：历史每 30 秒一个点，后续按实时上报展示；缺失不补零。`
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
            window={
              displayedRange === 'live'
                ? { start: (frozen?.end ?? liveEnd) - 600_000, end: frozen?.end ?? liveEnd }
                : result
                  ? { start, end }
                  : undefined
            }
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
