import type { TaskSummary } from '@/api/tasks';
import { MetricCard } from '@/components/arc/metric-card/metric-card';
export default function TaskMetrics({ summary }: { summary: TaskSummary | null }) {
  const metrics = [
    { label: '近 24 小时任务', value: summary?.total, context: '按创建时间统计，重试不重复计数' },
    {
      label: '成功率',
      value: summary?.success_rate,
      suffix: '%',
      context: '近 24 小时成功 /（成功 + 失败）',
    },
    { label: '执行中 / 排队', value: summary?.active, context: '当前全部未结束任务，单节点串行' },
    { label: '近 24 小时失败', value: summary?.failed, context: '查看失败任务了解原因' },
  ];
  return (
    <section aria-label="任务统计" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric) => (
        <div key={metric.label} className="min-h-44">
          <MetricCard
            label={metric.label}
            value={metric.value ?? 0}
            suffix={metric.suffix}
            decimals={metric.suffix ? 1 : 0}
            context={metric.context}
          />
        </div>
      ))}
    </section>
  );
}
