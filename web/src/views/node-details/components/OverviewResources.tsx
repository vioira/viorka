import {
  ChartNoAxesColumn,
  CircleAlert,
  Cpu,
  HardDrive,
  Info,
  type LucideIcon,
  MemoryStick,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { HistoryPoint } from '@/api/metric-history';
import {
  decimalBytes,
  decimalPercent,
  filesystemUsagePercent,
  type TelemetrySnapshot,
} from '@/api/telemetry';
import { billableTraffic, defaultTrafficSettings } from '@/api/traffic';
import { AnimatedCounter } from '@/components/arc/animated-counter/animated-counter';
import { Button } from '@/components/arc/button/button';
import { Sparkline } from '@/components/arc/sparkline/sparkline';
import { Tooltip } from '@/components/arc/tooltip/tooltip';
import { UsageMeter } from '@/components/arc/usage-meter/usage-meter';

export function usageTone(value: number | undefined) {
  return value === undefined
    ? 'accent'
    : value >= 95
      ? 'danger'
      : value >= 80
        ? 'warning'
        : 'success';
}
function UsageBar({ value, showValue = false }: { value?: number; showValue?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted"
        role="progressbar"
        aria-label="使用率"
        aria-valuenow={value === undefined ? undefined : Math.min(value, 100)}
        aria-valuetext={value === undefined ? '未知' : `${value.toFixed(1)}%`}
      >
        {value !== undefined && (
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.min(value, 100)}%`, background: `var(--${usageTone(value)})` }}
          />
        )}
      </div>
      {showValue && (
        <span className="text-(length:--text-xs) text-text-secondary tabular-nums">
          {value === undefined ? '未知' : `${value.toFixed(1)}%`}
        </span>
      )}
    </div>
  );
}
function Resource({
  label,
  icon: Icon,
  color,
  value,
  context,
  action,
  children,
}: {
  label: string;
  icon: LucideIcon;
  color: string;
  value?: ReactNode;
  context?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className="grid min-w-0 grid-rows-[auto_auto_1fr] gap-4 rounded-(--radius-panel) border-[1px] border-border bg-surface p-5"
    >
      <div className="flex h-6 items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-(length:--text-sm) font-medium">
          <Icon size={18} aria-hidden="true" style={{ color }} />
          {label}
        </h2>
        {action}
      </div>
      {value !== undefined && (
        <div className="space-y-1">
          <p className="text-(length:--text-2xl) font-medium tabular-nums">{value}</p>
          <div className="min-h-4 text-(length:--text-xs) text-text-secondary tabular-nums">
            {context}
          </div>
        </div>
      )}
      <div
        className={`flex min-w-0 flex-col justify-end ${value === undefined ? 'row-span-2 min-h-32' : 'min-h-16'}`}
      >
        {children}
      </div>
    </section>
  );
}
function ResourceSparkline({
  points,
  metric,
  value,
}: {
  points: HistoryPoint[];
  metric: string;
  value?: number;
}) {
  // Sparkline accepts a continuous numeric series. Keep only the latest run;
  // never join missing observations or synthesize zero values.
  let end = points.length - 1;
  while (end >= 0 && !points[end].stats[metric]) end--;
  let start = end;
  while (
    start > 0 &&
    points[start - 1].stats[metric] &&
    Date.parse(points[start].at) - Date.parse(points[start - 1].at) <= 60_000
  )
    start--;
  const run = end < 0 ? [] : points.slice(start, end + 1);
  return (
    <div className="min-w-0">
      {run.length > 1 ? (
        <Sparkline
          label={`${metric === 'cpu' ? 'CPU' : '内存'}最近 10 分钟`}
          showLabel={false}
          data={run.map((point) => point.stats[metric].sum / point.stats[metric].count)}
          labels={run.map((point) =>
            new Date(point.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
          )}
          width={280}
          height={36}
          area={false}
          tone={usageTone(value)}
          formatValue={(v) => `${v.toFixed(1)}%`}
        />
      ) : (
        <p className="pt-4 text-(length:--text-xs) text-text-secondary">等待连续采样</p>
      )}
    </div>
  );
}
export default function OverviewResources({
  telemetry,
  cpuPoints,
  memoryPoints,
}: {
  telemetry?: TelemetrySnapshot;
  cpuPoints: HistoryPoint[];
  memoryPoints: HistoryPoint[];
}) {
  const fast = telemetry?.fast;
  const full = telemetry?.full;
  const cpu = fast?.errors.includes('cpu_unavailable') ? undefined : fast?.cpu_percent;
  const load = full?.errors.includes('load_unavailable') ? undefined : full;
  const memory = fast?.errors.includes('memory_unavailable') ? undefined : fast;
  const ram = decimalPercent(memory?.ram_used, memory?.ram_total) ?? undefined;
  const disk = full?.errors.includes('disk_unavailable') ? undefined : full;
  const diskPercent = filesystemUsagePercent(disk?.disk_used, disk?.disk_available) ?? undefined;
  const traffic = fast?.errors.includes('traffic_unavailable') ? undefined : fast?.traffic;
  const billing = telemetry?.settings
    ? (telemetry.settings.traffic ?? defaultTrafficSettings)
    : undefined;
  const used = billing
    ? billableTraffic(traffic?.rx_bytes, traffic?.tx_bytes, billing.billing_mode)
    : undefined;
  const [, trafficUnit] = decimalBytes((used ?? 0n).toString()).split(' ');
  const quota = billing ? BigInt(billing.quota_bytes) : undefined;
  const ratio = used !== undefined && quota ? Number((used * 10000n) / quota) / 100 : undefined;
  const trafficDivisor = 1000 ** ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'].indexOf(trafficUnit);
  const trafficSegments = [
    ...(billing?.billing_mode !== 'outbound' && traffic?.rx_bytes !== undefined
      ? [{ id: 'rx', label: '接收', value: Number(traffic.rx_bytes) / trafficDivisor }]
      : []),
    ...(billing?.billing_mode !== 'inbound' && traffic?.tx_bytes !== undefined
      ? [{ id: 'tx', label: '发送', value: Number(traffic.tx_bytes) / trafficDivisor }]
      : []),
  ];
  const billingLabel = billing
    ? { both: '双向计费', inbound: '仅入站计费', outbound: '仅出站计费' }[billing.billing_mode]
    : '计费设置未知';
  const trafficDetails = [
    billingLabel,
    traffic?.month_start
      ? `周期始于 ${new Date(traffic.month_start).toLocaleDateString('zh-CN')}`
      : '',
    traffic?.quality.length ? '统计存在采集异常，详见指标页' : '',
  ]
    .filter(Boolean)
    .join('，');
  const TrafficIcon = traffic?.quality.length ? CircleAlert : Info;
  return (
    <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Resource
        label="CPU"
        icon={Cpu}
        color="var(--metric-cpu)"
        value={<AnimatedCounter value={cpu ?? 0} decimals={1} suffix="%" />}
        context={
          <span className="whitespace-nowrap">
            负载 <span className="sr-only">（1 / 5 / 15 分钟）</span>
            {[load?.load_1, load?.load_5, load?.load_15]
              .map((value) => (value === undefined ? '未知' : value.toFixed(2)))
              .join(' / ')}
          </span>
        }
      >
        <ResourceSparkline points={cpuPoints} metric="cpu" value={cpu} />
      </Resource>
      <Resource
        label="内存"
        icon={MemoryStick}
        color="var(--metric-memory)"
        value={<AnimatedCounter value={ram ?? 0} decimals={1} suffix="%" />}
        context={`${decimalBytes(memory?.ram_used ?? '0')} / ${decimalBytes(memory?.ram_total ?? '0')}`}
      >
        <ResourceSparkline points={memoryPoints} metric="memory" value={ram} />
      </Resource>
      <Resource
        label="文件系统"
        icon={HardDrive}
        color="var(--text-secondary)"
        value={<AnimatedCounter value={diskPercent ?? 0} decimals={1} suffix="%" />}
        context={`${decimalBytes(disk?.disk_used ?? '0')} / ${decimalBytes(disk?.disk_total ?? '0')}`}
      >
        <div className="pb-2">
          <UsageBar value={diskPercent} />
        </div>
      </Resource>
      <Resource
        label="当月流量"
        icon={ChartNoAxesColumn}
        color={`var(--${usageTone(ratio)})`}
        value={used === undefined ? '未知' : undefined}
        context={
          quota !== undefined && used !== undefined && quota > 0n && used > quota ? (
            <span className="text-danger">已超出 {decimalBytes((used - quota).toString())}</span>
          ) : quota ? (
            `额度 ${decimalBytes(quota.toString())}`
          ) : quota === 0n ? (
            '无限额度'
          ) : (
            '额度未知'
          )
        }
        action={
          <Tooltip openOnClick content={trafficDetails}>
            <Button
              variant="ghost"
              aria-label={
                traffic?.quality.length ? '查看流量采集异常与计费信息' : '查看流量计费信息'
              }
            >
              <TrafficIcon
                size={16}
                aria-hidden="true"
                className={traffic?.quality.length ? 'text-warning' : 'text-text-secondary'}
              />
            </Button>
          </Tooltip>
        }
      >
        {used !== undefined && quota !== undefined ? (
          <UsageMeter
            summary
            label="当月计费流量"
            segments={trafficSegments}
            limit={quota > 0n ? Number(quota) / trafficDivisor : undefined}
            unit={trafficUnit}
            decimals={trafficUnit === 'B' ? 0 : 1}
            freeLabel="剩余"
            overLabel="超出"
          />
        ) : (
          <span className="text-(length:--text-xs) text-text-secondary">等待有效流量数据</span>
        )}
      </Resource>
    </div>
  );
}
