import { Activity, Cpu, HardDrive, MemoryStick, Network } from 'lucide-react';
import type { MetricHistory } from '@/api/metric-history';
import { nodeTime } from '@/api/nodes';
import { LineChart } from '@/components/arc/line-chart/line-chart';
import { bitsPerSecond, continuousChartData, type MetricChart } from './metric-chart';

const icons = { memory: MemoryStick, network: Network, load: Activity, cpu: Cpu, disk: HardDrive };
export default function MetricTrend({
  chart,
  data,
  loading,
}: {
  chart: MetricChart;
  data?: MetricHistory;
  loading: boolean;
}) {
  const continuous = continuousChartData(data, chart.series);
  const missing = chart.series.filter(
    (item) => !continuous.series.some((series) => series.key === item.key),
  );
  const Icon = icons[chart.key as keyof typeof icons];
  const format = (value: number) =>
    chart.unit === 'bps' ? bitsPerSecond(value) : `${Number(value.toFixed(2))}${chart.unit}`;
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
        label={`${chart.label}采样平均值`}
        categoryLabel="采样时间"
        height={180}
        loading={loading}
        legend
        curve="smooth"
        emptyLabel={data ? '暂无有效历史采样' : '历史指标尚未读取'}
        data={continuous.points.map((point) => ({
          key: point.at,
          label: nodeTime(point.at),
          axisLabel: new Date(point.at).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
          }),
          values: Object.fromEntries(
            continuous.series.map((item) => [
              item.key,
              point.stats[item.key].sum / point.stats[item.key].count,
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
        {first && last
          ? `连续采样：${nodeTime(first.at)} 至 ${nodeTime(last.at)}`
          : '等待有效采样。'}
        {missing.length > 0 && ` ${missing.map((item) => item.label).join('、')}暂无有效数据。`}
      </p>
    </section>
  );
}
