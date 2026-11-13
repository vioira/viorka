import { AlertCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import type { TrafficRange } from '@/api/overview';
import { Button } from '@/components/arc/button/button';
import { LineChart } from '@/components/arc/line-chart/line-chart';
import { MetricCard } from '@/components/arc/metric-card/metric-card';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { Skeleton } from '@/components/arc/skeleton/skeleton';
import { GenerateEnrollment } from '@/components/enrollment/EnrollmentDialogs';
import NodeInventory from '@/components/node-inventory';
import { useNodes } from '@/hooks/use-nodes';
import { useOverview } from '../use-overview';

const ranges = [
  { value: 'day', label: '今日' },
  { value: 'week', label: '近 7 天' },
  { value: 'month', label: '近 30 天' },
];
const series = [
  { key: 'outbound', label: '出站', color: 'var(--foreground)', area: false },
  { key: 'inbound', label: '入站', color: 'var(--accent)', area: false },
];

function Stat({
  label,
  value,
  suffix,
  context,
  loading = false,
}: {
  label: string;
  value: number | null | undefined;
  suffix?: string;
  context: string;
  loading?: boolean;
}) {
  if (value != null)
    return (
      <MetricCard
        label={label}
        value={value}
        suffix={suffix}
        decimals={suffix === ' %' || suffix === ' GB' ? 2 : 0}
        context={context}
      />
    );
  return (
    <article className="min-h-44 rounded-(--radius-panel) border-[1px] border-border bg-(--surface) p-5">
      <p className="text-(length:--text-sm) text-text-secondary">{label}</p>
      <div className="my-4 min-h-10">
        {loading ? (
          <Skeleton lines={1} label={`正在读取${label}`} />
        ) : (
          <span className="text-(length:--text-2xl)">—</span>
        )}
      </div>
      <p className="text-(length:--text-sm) text-text-secondary">{context}</p>
    </article>
  );
}

export default function OverviewPage() {
  const session = useOutletContext<Session>();
  const [range, setRange] = useState<TrafficRange>('week');
  const { overview, traffic, loading, refresh } = useOverview(range);
  const nodes = useNodes(5, 'overview-load');
  const trafficValue =
    traffic?.rx_bytes != null && traffic.tx_bytes != null
      ? Number(BigInt(traffic.rx_bytes) + BigInt(traffic.tx_bytes)) / 1e9
      : null;
  const points =
    (trafficValue == null ? [] : traffic?.points)?.map((point) => ({
      key: point.date,
      label: `${point.date}${point.partial ? '（数据不完整）' : ''}`,
      axisLabel: point.date.slice(5),
      values: {
        outbound: point.tx_bytes == null ? null : Number(point.tx_bytes) / 1e9,
        inbound: point.rx_bytes == null ? null : Number(point.rx_bytes) / 1e9,
      },
    })) ?? [];
  const title = `${ranges.find((item) => item.value === range)?.label}流量`;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label="流量统计范围"
          value={range}
          onValueChange={(value) => setRange(value as TrafficRange)}
          options={ranges}
        />
        <div className="ml-auto flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            disabled={loading || nodes.loading}
            onClick={() => {
              refresh();
              void nodes.refresh();
            }}
          >
            刷新总览
          </Button>
          <GenerateEnrollment
            session={session}
            disabled={session.user.role !== 'admin'}
            triggerLabel="添加节点"
            onCreated={() => {
              refresh();
              return nodes.created();
            }}
          />
        </div>
      </div>
      <div
        className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4"
        role="group"
        aria-label="运行指标"
        aria-busy={loading}
      >
        <Stat
          label="节点"
          value={overview?.nodes}
          suffix=" 台"
          loading={loading}
          context={
            overview
              ? `${overview.online} 在线，${overview.offline} 离线，${overview.pending} 待注册，${overview.disabled} 已禁用`
              : '节点数量未知'
          }
        />
        <Stat
          label="代理服务"
          value={overview?.services}
          suffix=" 个"
          loading={loading}
          context={
            overview
              ? `${overview.synced} 已同步，${overview.pending_services} 待同步，${overview.failed_services} 同步失败`
              : '服务数量未知'
          }
        />
        <Stat
          label={title}
          value={trafficValue}
          suffix=" GB"
          context={
            traffic
              ? traffic.partial
                ? '已上报用量，部分数据缺失或过期'
                : trafficValue == null
                  ? '尚无流量记录'
                  : '入站与出站合计'
              : '流量尚未读取'
          }
        />
        <Stat
          label="任务成功率"
          value={overview?.tasks.success_rate || 0}
          suffix=" %"
          loading={loading}
          context={
            overview
              ? `近 24 小时 ${overview.tasks.total} 个任务，${overview.tasks.failed} 个失败`
              : '任务统计未知'
          }
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <section
          aria-labelledby="traffic-heading"
          className="min-w-0 rounded-(--radius-panel) border-[1px] border-border bg-(--surface) p-5"
        >
          <h2 id="traffic-heading" className="font-medium">
            全网流量
          </h2>
          <p className="mt-1 mb-4 text-(length:--text-xs) text-text-secondary">
            按日记录起始日期汇总
            {traffic ? `（${traffic.timezone}），统计 ${traffic.expected_nodes} 个已注册节点` : ''}
          </p>
          <LineChart
            label={title}
            data={points}
            series={series}
            unit="GB"
            height={200}
            categoryLabel="日期"
            formatValue={(value) => value.toFixed(2)}
            emptyLabel={traffic ? '此时间范围暂无流量记录' : '流量尚未读取'}
          />
        </section>
        <section
          aria-labelledby="attention-heading"
          className="min-w-0 rounded-(--radius-panel) border-[1px] border-border bg-(--surface) p-5"
        >
          <h2 id="attention-heading" className="font-medium">
            需要关注
          </h2>
          <ul className="mt-6 space-y-6">
            {overview?.attention.map((item) => (
              <li key={`${item.node_id}-${item.title}`} className="flex items-start gap-3">
                <AlertCircle
                  size={16}
                  aria-hidden="true"
                  className={`mt-1 shrink-0 ${item.tone === 'danger' ? 'text-danger' : 'text-warning'}`}
                />
                <div className="min-w-0 wrap-anywhere">
                  <Link
                    className="font-medium hover:underline"
                    to={`/nodes/${encodeURIComponent(item.node_id)}`}
                  >
                    {item.title}
                  </Link>
                  <p className="mt-1 text-(length:--text-xs) leading-relaxed text-text-secondary">
                    {item.detail}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          {(!overview || overview.attention.length === 0) && (
            <p role="status" className="mt-6 text-(length:--text-sm) text-text-secondary">
              {overview ? '暂无需要关注的事项' : '提醒尚未读取'}
            </p>
          )}
        </section>
      </div>
      <NodeInventory
        nodes={nodes.nodes}
        loaded={nodes.loaded}
        loading={nodes.loading}
        emptyMessage="暂无节点，请添加节点"
      />
    </>
  );
}
