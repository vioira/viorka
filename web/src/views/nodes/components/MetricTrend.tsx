import { Activity, Cpu, HardDrive, Layers, MemoryStick, Network } from 'lucide-react';
import { memo } from 'react';
import type { MetricHistory } from '@/api/metric-history';
import { nodeTime } from '@/api/nodes';
import type { LivePoint } from '@/api/realtime';
import { LineChart } from '@/components/arc/line-chart/line-chart';
import {
  availableChartData,
  bitsPerSecond,
  byteRate,
  historyChartData,
  type MetricChart,
} from './metric-chart';

const icons = {
  memory: MemoryStick,
  network: Network,
  load: Activity,
  cpu: Cpu,
  disk: HardDrive,
  disk_io: HardDrive,
  connections: Network,
  processes: Layers,
};
function MetricTrend({
  chart,
  data,
  loading,
  livePoints,
  window,
}: {
  chart: MetricChart;
  data?: MetricHistory;
  loading: boolean;
  livePoints?: LivePoint[];
  window?: { start: number; end: number };
}) {
  const continuous = livePoints
    ? availableChartData(data, chart.series)
    : historyChartData(data, chart.series, window);
  const missing = chart.series.filter(
    (item) => !continuous.series.some((series) => series.key === item.key),
  );
  const Icon = icons[chart.key as keyof typeof icons];
  const format = (value: number) =>
    chart.unit === 'bps'
      ? bitsPerSecond(value)
      : chart.unit === 'B/s'
        ? byteRate(value)
        : `${Number(value.toFixed(chart.unit === '个' ? 0 : 2))}${chart.unit}`;
  const first = continuous.points[0];
  const last = continuous.points.at(-1);
  return (
    <section
      aria-label={`${chart.label}指标`}
      className="min-w-0 rounded-(--radius-panel) border-[0.5px] border-border bg-surface p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 className="flex items-center gap-2 font-medium">
          <Icon
            size={18}
            strokeWidth={1.75}
            aria-hidden="true"
            style={{ color: chart.series[0].color }}
          />
          {chart.label}
        </h4>
        <div className="min-w-0 text-right tabular-nums">
          <p className="wrap-anywhere">
            <span className="sr-only">当前采样：</span>
            {chart.value}
          </p>
          <p className="mt-1 wrap-anywhere text-(length:--text-xs) text-text-secondary">
            {chart.detail}
          </p>
        </div>
      </div>
      <LineChart
        className="mt-4"
        label={`${chart.label}${livePoints ? '实时采样' : '采样平均值'}`}
        categoryLabel="采样时间"
        height={180}
        loading={loading && !data}
        realtime={livePoints !== undefined}
        legend
        curve="smooth"
        emptyLabel={livePoints ? '等待有效采样' : data ? '暂无有效历史采样' : '历史指标尚未读取'}
        data={continuous.points.map((point) => ({
          key: point.at,
          label: nodeTime(point.at),
          axisLabel: new Date(point.at).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
            ...(livePoints ? { second: '2-digit' as const } : {}),
          }),
          values: Object.fromEntries(
            continuous.series.map((item) => [
              item.key,
              point.stats[item.key]
                ? point.stats[item.key].sum / point.stats[item.key].count
                : null,
            ]),
          ),
        }))}
        series={continuous.series.map((item, index) => ({
          key: item.key,
          label: item.label,
          color: item.color,
          dashed: !!item.dash,
          area: index === 0,
        }))}
        formatValue={format}
        formatTick={(value) =>
          chart.unit === 'bps' ? bitsPerSecond(value).replace('bps', '') : format(value)
        }
      />
      <p className="mt-3 min-h-8 text-(length:--text-xs) text-text-secondary tabular-nums">
        {livePoints
          ? `有效数据点：${continuous.points.length} 个，初始分钟均值与后续实时采样。`
          : first && last
            ? `显示时段：${nodeTime(first.at)} 至 ${nodeTime(last.at)}，缺失采样处断线。`
            : '等待有效采样。'}
        {missing.length > 0 && ` ${missing.map((item) => item.label).join('、')}暂无有效数据。`}
      </p>
    </section>
  );
}

export default memo(MetricTrend);
