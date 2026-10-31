import { useEffect, useId, useState } from 'react';
import {
  getMetricHistory,
  type HistoryRange,
  type MetricHistory,
  rangeSeconds,
} from '@/api/metric-history';
import { bytes, type HostMetrics } from '@/api/monitoring';
import { nodeTime } from '@/api/nodes';
import { Button } from '@/components/arc/button/button';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import MetricTrend from './MetricTrend';
import { metricCharts } from './metric-chart';

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
] as const;

export default function NodeMetricHistory({
  id,
  active,
  compact = false,
  live,
}: {
  id: string;
  active: boolean;
  compact?: boolean;
  live?: HostMetrics;
}) {
  const charts = metricCharts(live).filter(
    (chart) => !compact || ['cpu', 'memory'].includes(chart.key),
  );
  const visibleMetrics = metrics.filter(([key]) =>
    charts.some((chart) => chart.series.some((series) => series.key === key)),
  );
  const [range, setRange] = useState<HistoryRange>(compact ? '24h' : '1h');
  const [result, setResult] = useState<{ data: MetricHistory; range: HistoryRange; end: number }>();
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [showValues, setShowValues] = useState(false);
  const [, report] = useToastFeedback('error');
  const valuesID = useId();
  useEffect(() => {
    void retry;
    if (!active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
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
          timer = setTimeout(load, 30000);
        }
      }
    };
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [id, active, range, retry, report]);
  const data = result?.data;
  const end = result?.end ?? 0;
  const start = end - rangeSeconds[result?.range ?? range] * 1000;
  return (
    <section
      aria-label="历史资源趋势"
      aria-busy={loading}
      className="space-y-4 border-t-[0.5px] border-border pt-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">历史资源趋势</h3>
        <Button variant="ghost" className="min-h-11" onClick={() => setRetry((n) => n + 1)}>
          刷新历史
        </Button>
      </div>
      <SegmentedControl
        label="历史时间范围"
        className="[--control-height-sm:44px]"
        value={range}
        onValueChange={(v) => setRange(v as HistoryRange)}
        options={[
          { value: '1h', label: '1 小时' },
          { value: '6h', label: '6 小时' },
          { value: '24h', label: '24 小时' },
          { value: '7d', label: '7 天' },
        ]}
      />
      <p className="text-(length:--text-xs) text-text-secondary" role="status">
        {result
          ? `当前显示：${nodeTime(new Date(start).toISOString())} 至 ${nodeTime(new Date(end).toISOString())}，每 ${result.data.period_seconds / 60} 分钟汇总。`
          : loading
            ? '正在读取历史指标…'
            : '历史指标尚未读取。'}{' '}
        曲线为采样平均值，卡片顶部为当前有效采样；峰值见采样数值。图表仅展示最近连续有效采样，缺失不补零；完整历史见采样数值。历史保留
        7 天。网络为非回环网卡合计，可能重复计数。
      </p>
      <div
        className={
          compact
            ? 'grid min-w-0 grid-cols-1 gap-4'
            : 'grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3'
        }
      >
        {charts.map((chart) => (
          <MetricTrend key={chart.key} chart={chart} data={data} loading={loading} />
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
                    unit === 'B/s' ? `${bytes(n)}/s` : `${n.toFixed(1)}${unit}`;
                  return (
                    <div key={key}>
                      <dt className="text-text-secondary">{label}</dt>
                      <dd className="tabular-nums">
                        {s
                          ? `平均 ${fmt(s.sum / s.count)}，峰值 ${fmt(s.max)}，${s.count} 个有效样本`
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
