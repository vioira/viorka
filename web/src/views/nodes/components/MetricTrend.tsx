import { Activity, Cpu, HardDrive, Layers, MemoryStick, Network } from 'lucide-react';
import { memo } from 'react';
import type { MetricTrend as TrendData } from '@/api/metric-trends';
import { LineChart } from '@/components/arc/line-chart/line-chart';
import { bitsPerSecond, byteRate, type MetricChart } from './metric-chart';

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
  realtime,
}: {
  chart: MetricChart;
  data?: TrendData;
  loading: boolean;
  realtime?: boolean;
}) {
  const Icon = icons[chart.key as keyof typeof icons] ?? HardDrive;
  return (
    <section aria-label={`${chart.label}指标`} className="v-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 className="v-card-title flex items-center gap-2">
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
      <MetricPlot chart={chart} data={data} loading={loading} realtime={realtime} />
    </section>
  );
}

export default memo(MetricTrend);

export const MetricPlot = memo(
  function MetricPlot({
    chart,
    data,
    loading,
    realtime,
  }: {
    chart: MetricChart;
    data?: TrendData;
    loading: boolean;
    realtime?: boolean;
  }) {
    const points = data?.points ?? [];
    const format = (value: number) =>
      chart.unit === 'bps'
        ? bitsPerSecond(value)
        : chart.unit === 'B/s'
          ? byteRate(value)
          : `${Number(value.toFixed(chart.unit === '个' ? 0 : 2))}${chart.unit}`;
    const historyLabel = { mean: '采样平均值', peak: '采样峰值', latest: '最新值' }[
      data?.statistic ?? 'mean'
    ];
    const sampleTime = new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    const firstDate = new Date(points[0]?.at ?? 0);
    const lastDate = new Date(points.at(-1)?.at ?? 0);
    const spansDays = firstDate.toDateString() !== lastDate.toDateString();
    const sampleDate = new Intl.DateTimeFormat('zh-CN', {
      ...(firstDate.getFullYear() !== lastDate.getFullYear() ? { year: 'numeric' as const } : {}),
      month: '2-digit',
      day: '2-digit',
    });
    const shortHistoryLabel = {
      采样平均值: '均值',
      采样峰值: '峰值',
      最新值: '最新值',
      历史统计: '历史',
    }[historyLabel];
    const pointLabel = (at: string, raw: boolean) => {
      const start = new Date(at);
      const end = new Date(start.getTime() + (data?.period_seconds ?? 30) * 1000);
      const showDate = spansDays || (!raw && start.toDateString() !== end.toDateString());
      const formatTime = (date: Date) =>
        `${showDate ? `${sampleDate.format(date)} ` : ''}${sampleTime.format(date)}`;
      return raw
        ? `${formatTime(start)}（实时）`
        : `${formatTime(start)}–${formatTime(end)}（${shortHistoryLabel}）`;
    };
    const axisTime = new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    return (
      <LineChart
        className="mt-4"
        label={`${chart.label}${realtime ? '实时采样' : historyLabel}`}
        categoryLabel={realtime ? '采样时间' : '聚合时段'}
        height={180}
        loading={loading}
        realtime={!!realtime}
        legend
        curve="smooth"
        emptyLabel={realtime ? '等待有效采样' : data ? '暂无有效历史采样' : '历史指标尚未读取'}
        data={points.map((point) => ({
          key: point.at,
          label:
            pointLabel(point.at, !!realtime && point.source !== 'history') +
            (chart.key.startsWith('disk_io') && point.partial ? '（部分数据）' : ''),
          axisLabel: axisTime.format(new Date(point.at)),
          values: point.values,
        }))}
        series={chart.series.map((item, index) => ({
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
    );
  },
  (previous, next) =>
    previous.data === next.data &&
    previous.loading === next.loading &&
    previous.realtime === next.realtime &&
    previous.chart.key === next.chart.key &&
    previous.chart.label === next.chart.label &&
    previous.chart.unit === next.chart.unit &&
    JSON.stringify(previous.chart.series) === JSON.stringify(next.chart.series),
);
