import { memo, useEffect, useId, useMemo, useState } from 'react';
import {
  getMetricHistory,
  type HistoryRange,
  type MetricHistory,
  rangeSeconds,
} from '@/api/metric-history';
import { bytes, type HostMetrics } from '@/api/monitoring';
import { nodeTime } from '@/api/nodes';
import type { LivePoint } from '@/api/realtime';
import { Button } from '@/components/arc/button/button';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { useChangeVersion } from '@/hooks/realtime';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import MetricTrend from './MetricTrend';
import { metricCharts } from './metric-chart';

const emptyPoints: LivePoint[] = [];

const metrics = [
  ['cpu', 'CPU 使用率', '%'],
  ['memory', '内存使用率', '%'],
  ['swap', 'Swap 使用率', '%'],
  ['disk', '根文件系统使用率', '%'],
  ['load_one', '1 分钟负载', ''],
  ['load_five', '5 分钟负载', ''],
  ['load_fifteen', '15 分钟负载', ''],
  ['rx', '接收速率合计', 'B/s'],
  ['tx', '发送速率合计', 'B/s'],
  ['disk_read', '磁盘读取速率合计', 'B/s'],
  ['disk_write', '磁盘写入速率合计', 'B/s'],
  ['tcp_sockets', 'TCP socket 数', '个'],
  ['udp_sockets', 'UDP socket 数', '个'],
  ['processes', '进程数', '个'],
] as const;

function NodeMetricHistory({
  id,
  active,
  compact = false,
  live,
  points,
}: {
  id: string;
  active: boolean;
  compact?: boolean;
  live?: HostMetrics;
  points?: LivePoint[];
}) {
  const eventVersion = useChangeVersion('history', id);
  const [frozen, setFrozen] = useState<{ live?: HostMetrics; points: LivePoint[] }>();
  const displayedLive = frozen ? frozen.live : live;
  const charts = useMemo(
    () =>
      metricCharts(displayedLive).filter(
        (chart) => !compact || ['cpu', 'memory'].includes(chart.key),
      ),
    [displayedLive, compact],
  );
  const visibleMetrics = metrics.filter(([key]) =>
    charts.some((chart) => chart.series.some((series) => series.key === key)),
  );
  const [range, setRange] = useState<HistoryRange | 'live'>(compact ? '24h' : 'live');
  const [result, setResult] = useState<{ data: MetricHistory; range: HistoryRange; end: number }>();
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [showValues, setShowValues] = useState(false);
  const [, report] = useToastFeedback('error');
  const valuesID = useId();
  useEffect(() => {
    void eventVersion; // A committed change invalidates this read.
    void retry;
    if (!active || range === 'live') return;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      try {
        const data = await getMetricHistory(id, range, controller.signal);
        if (!controller.signal.aborted) {
          setResult({ data, range, end: Date.now() });
          report('');
        }
      } catch (e) {
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
    };
  }, [id, active, range, retry, report, eventVersion]);
  const livePoints = frozen ? frozen.points : (points ?? emptyPoints);
  const data = useMemo<MetricHistory | undefined>(
    () =>
      range === 'live'
        ? {
            period_seconds: 1,
            points: livePoints.map((p) => ({
              at: p.at,
              last_sample_at: p.at,
              stats: Object.fromEntries(
                Object.entries(p.values).map(([key, value]) => [
                  key,
                  { sum: value, max: value, count: 1 },
                ]),
              ),
            })),
          }
        : result?.data,
    [range, livePoints, result?.data],
  );
  const end = result?.end ?? 0;
  const start = end - rangeSeconds[result?.range ?? (range === 'live' ? '1h' : range)] * 1000;
  return (
    <section
      aria-label="资源趋势"
      aria-busy={range !== 'live' && loading}
      className="space-y-4 border-t-[0.5px] border-border pt-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">资源趋势</h3>
        {range === 'live' ? (
          <Button
            variant="ghost"
            className="min-h-11"
            onClick={() => setFrozen(frozen ? undefined : { live, points: points ?? [] })}
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
          setFrozen(undefined);
          setRange(v as HistoryRange | 'live');
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
      <p className="min-h-10 text-(length:--text-xs) text-text-secondary" role="status">
        {range === 'live'
          ? `${frozen ? '显示已暂停。' : ''}最近 10 分钟，初始按分钟均值加载，后续追加实时采样，最多 120 点；缺失不补零。`
          : result
            ? `当前显示：${nodeTime(new Date(start).toISOString())} 至 ${nodeTime(new Date(end).toISOString())}，每 ${result.data.period_seconds / 60} 分钟汇总。曲线为采样平均值，卡片顶部为当前有效采样。历史保留 7 天，完整记录见采样数值。`
            : loading
              ? '正在读取历史指标…'
              : '历史指标尚未读取。'}
      </p>
      <div
        className={
          compact
            ? 'grid min-w-0 grid-cols-1 gap-4'
            : 'grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3'
        }
      >
        {charts.map((chart) => (
          <MetricTrend
            key={chart.key}
            chart={chart}
            data={data}
            window={range !== 'live' && result ? { start, end } : undefined}
            loading={range !== 'live' && loading}
            livePoints={range === 'live' ? livePoints : undefined}
          />
        ))}
      </div>
      <Button
        variant="secondary"
        className="min-h-11"
        disabled={!data}
        aria-expanded={showValues}
        aria-controls={valuesID}
        onClick={() => setShowValues((v) => !v)}
      >
        {showValues ? '收起采样数值' : '查看采样数值'}
      </Button>
      <div id={valuesID} hidden={!showValues} className="max-h-96 space-y-4 overflow-auto">
        {showValues &&
          data?.points.map((p) => (
            <section
              key={p.at}
              aria-label={nodeTime(p.at)}
              className="border-t-[0.5px] border-border pt-2"
            >
              <h4 className="font-medium">{nodeTime(p.at)}</h4>
              <dl className="grid gap-2 sm:grid-cols-2">
                {visibleMetrics.map(([key, label, unit]) => {
                  const s = p.stats[key];
                  const fmt = (n: number) =>
                    unit === 'B/s' ? `${bytes(n)}/s` : `${n.toFixed(unit === '个' ? 0 : 1)}${unit}`;
                  return (
                    <div key={key}>
                      <dt className="text-text-secondary">{label}</dt>
                      <dd className="tabular-nums">
                        {s
                          ? range === 'live'
                            ? fmt(s.sum / s.count)
                            : `平均 ${fmt(s.sum / s.count)}，峰值 ${fmt(s.max)}，${s.count} 个有效样本`
                          : '未知'}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </section>
          ))}
      </div>
    </section>
  );
}

// Parent clocks update freshness text, not unchanged chart data.
export default memo(NodeMetricHistory);
