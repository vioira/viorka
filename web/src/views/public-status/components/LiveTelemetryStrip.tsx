import { ArrowDown, ArrowUp, Cpu, HardDrive, MemoryStick, Network } from 'lucide-react';
import type { MetricTrendPoint } from '@/api/metric-trends';
import type { StatusNode } from '@/api/public-status';
import { decimalBytes, decimalPercent, filesystemUsagePercent } from '@/api/telemetry';
import { AnimatedCounter } from '@/components/arc/animated-counter/animated-counter';
import { Button } from '@/components/arc/button/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/arc/popover/popover';
import { Sparkline } from '@/components/arc/sparkline/sparkline';
import { UsageBar } from '@/components/usage/UsageBar';
import { usageTone } from '@/utils/usage-tone';
import { byteRate } from '@/views/nodes/components/metric-chart';
import { speed, statusFastFresh, statusFullFresh } from '../format';

function SpeedPulseStrip({ speeds }: { speeds: StatusNode['speeds'] }) {
  const samples = speeds.slice(-20);
  const hasReadings = samples.some((item) => item.rx != null || item.tx != null);
  if (!hasReadings) {
    return <p className="text-(length:--text-xs) text-text-secondary">等待实时速率样本</p>;
  }
  const peak = Math.max(1, ...samples.map((item) => Math.max(item.rx ?? 0, item.tx ?? 0)));
  return (
    <div
      role="img"
      aria-label={`最近 ${samples.length} 次快速采样上行与下行脉冲`}
      className="flex h-10 w-full flex-col justify-center gap-0.5"
    >
      <div className="flex h-4 items-end gap-0.5">
        {samples.map((item) => {
          const height = item.tx == null ? 0 : Math.max(12, Math.round((item.tx / peak) * 100));
          return (
            <span
              key={`tx-${item.at}`}
              className="min-w-0 flex-1 rounded-t-xs"
              style={{
                height: `${height}%`,
                backgroundColor: item.tx == null ? 'var(--border)' : 'var(--traffic-upload)',
              }}
            />
          );
        })}
      </div>
      <div className="h-[1px] w-full bg-border" aria-hidden="true" />
      <div className="flex h-4 items-start gap-0.5">
        {samples.map((item) => {
          const height = item.rx == null ? 0 : Math.max(12, Math.round((item.rx / peak) * 100));
          return (
            <span
              key={`rx-${item.at}`}
              className="min-w-0 flex-1 rounded-b-xs"
              style={{
                height: `${height}%`,
                backgroundColor: item.rx == null ? 'var(--border)' : 'var(--traffic-download)',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function CpuSparkline({ points, value }: { points?: MetricTrendPoint[]; value?: number }) {
  if (!points?.length) {
    return <UsageBar value={value} label="CPU 使用率" />;
  }
  let end = points.length - 1;
  while (end >= 0 && typeof points[end]?.values.cpu !== 'number') end--;
  let start = end;
  while (start > 0 && typeof points[start - 1]?.values.cpu === 'number') start--;
  const run = end < 0 ? [] : points.slice(Math.max(start, end - 19), end + 1);
  if (run.length < 2) {
    return <UsageBar value={value} label="CPU 使用率" />;
  }
  return (
    <Sparkline
      label="CPU 近期趋势"
      showLabel={false}
      data={run.map((point) => point.values.cpu as number)}
      labels={run.map((point) =>
        new Date(point.at).toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }),
      )}
      width={260}
      height={36}
      area={false}
      tone={usageTone(value)}
      formatValue={(v) => `${v.toFixed(1)}%`}
    />
  );
}

const knownLoad = (value: number | null | undefined) =>
  value == null ? '未知' : Number(value.toFixed(2));

export default function LiveTelemetryStrip({
  node,
  now,
  cpuPoints,
}: {
  node: StatusNode;
  now: number;
  cpuPoints?: MetricTrendPoint[];
}) {
  const fast = statusFastFresh(node, now) ? node.fast : null;
  const full = statusFullFresh(node, now) ? node.full : null;

  const cpu = fast?.cpu ?? undefined;
  const ramPercent =
    decimalPercent(fast?.ram_used ?? undefined, fast?.ram_total ?? undefined) ?? undefined;
  const swapPercent =
    fast?.swap_used != null && fast?.swap_total != null && Number(fast.swap_total) > 0
      ? (decimalPercent(fast.swap_used, fast.swap_total) ?? undefined)
      : undefined;
  const diskPercent =
    full != null
      ? (filesystemUsagePercent(full.disk_used ?? undefined, full.disk_available ?? undefined) ??
        undefined)
      : undefined;

  const diskIO = full?.disk_io;
  const ioDetailsAvailable = Boolean(
    diskIO &&
      (diskIO.read_iops != null ||
        diskIO.write_iops != null ||
        diskIO.await_ms != null ||
        diskIO.util_percent != null),
  );

  return (
    <section
      aria-label="实时体征概览"
      className="grid min-w-0 items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      <article className="v-card flex flex-col justify-between gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-(length:--text-sm) font-medium text-foreground">
            <Cpu
              size={17}
              strokeWidth={1.75}
              aria-hidden="true"
              style={{ color: 'var(--metric-cpu)' }}
            />
            <span>CPU 与负载</span>
          </h2>
          <span className="text-(length:--text-xs) text-text-secondary tabular-nums">
            {node.cpu_cores ? `${node.cpu_cores} 核` : '核数未登记'}
          </span>
        </div>

        <div className="space-y-1">
          <p className="text-(length:--text-2xl) font-medium text-foreground tabular-nums">
            {cpu !== undefined ? <AnimatedCounter value={cpu} decimals={1} suffix="%" /> : '未知'}
          </p>
          <p className="min-h-4 text-(length:--text-xs) text-text-secondary tabular-nums">
            {!fast
              ? node.fast
                ? 'CPU 采样已过期'
                : '等待 CPU 采样'
              : full && (full.load1 != null || full.load5 != null || full.load15 != null)
                ? `负载 ${[full.load1, full.load5, full.load15].map(knownLoad).join(' / ')}`
                : node.full
                  ? '负载采样已过期'
                  : '等待负载采样'}
          </p>
        </div>

        <div className="pt-1">
          <CpuSparkline points={cpuPoints} value={cpu} />
        </div>
      </article>

      <article className="v-card flex flex-col justify-between gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-(length:--text-sm) font-medium text-foreground">
            <MemoryStick
              size={17}
              strokeWidth={1.75}
              aria-hidden="true"
              style={{ color: 'var(--metric-memory)' }}
            />
            <span>内存与 Swap</span>
          </h2>
          <span className="text-(length:--text-xs) text-text-secondary tabular-nums">
            {fast?.ram_total ? decimalBytes(fast.ram_total) : '总量未知'}
          </span>
        </div>

        <div className="space-y-1">
          <p className="text-(length:--text-2xl) font-medium text-foreground tabular-nums">
            {ramPercent !== undefined ? (
              <AnimatedCounter value={ramPercent} decimals={1} suffix="%" />
            ) : (
              '未知'
            )}
          </p>
          <p className="min-h-4 text-(length:--text-xs) text-text-secondary tabular-nums">
            {!fast
              ? node.fast
                ? '内存采样已过期'
                : '等待内存采样'
              : fast.ram_used != null
                ? `${decimalBytes(fast.ram_used)} 已用${
                    fast.swap_used != null && fast.swap_total != null && Number(fast.swap_total) > 0
                      ? `，Swap ${decimalBytes(fast.swap_used)} / ${decimalBytes(fast.swap_total)}`
                      : ''
                  }`
                : '内存用量未知'}
          </p>
        </div>

        <div className="space-y-1.5 pt-1">
          <UsageBar value={ramPercent} label="内存使用率" />
          {swapPercent !== undefined && <UsageBar value={swapPercent} label="Swap 使用率" />}
        </div>
      </article>

      <article className="v-card flex flex-col justify-between gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-(length:--text-sm) font-medium text-foreground">
            <Network
              size={17}
              strokeWidth={1.75}
              aria-hidden="true"
              style={{ color: 'var(--accent)' }}
            />
            <span>实时网络速率</span>
          </h2>
          <span className="text-(length:--text-xs) text-text-secondary tabular-nums">
            {fast?.tcp_inuse != null && fast?.udp_inuse != null
              ? `TCP ${fast.tcp_inuse} / UDP ${fast.udp_inuse}`
              : '连接数未知'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 tabular-nums">
          <div className="min-w-0 space-y-0.5">
            <span className="inline-flex items-center gap-1 text-(length:--text-xs) text-text-secondary">
              <ArrowUp size={12} aria-hidden="true" style={{ color: 'var(--traffic-upload)' }} />
              上行
            </span>
            <p className="wrap-anywhere text-(length:--text-base) font-medium text-foreground">
              {fast?.tx != null ? speed(fast.tx) : '未知'}
            </p>
          </div>
          <div className="min-w-0 space-y-0.5">
            <span className="inline-flex items-center gap-1 text-(length:--text-xs) text-text-secondary">
              <ArrowDown
                size={12}
                aria-hidden="true"
                style={{ color: 'var(--traffic-download)' }}
              />
              下行
            </span>
            <p className="wrap-anywhere text-(length:--text-base) font-medium text-foreground">
              {fast?.rx != null ? speed(fast.rx) : '未知'}
            </p>
          </div>
        </div>

        <div className="pt-1">
          <SpeedPulseStrip speeds={node.speeds} />
        </div>
      </article>

      <article className="v-card flex flex-col justify-between gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-(length:--text-sm) font-medium text-foreground">
            <HardDrive
              size={17}
              strokeWidth={1.75}
              aria-hidden="true"
              style={{ color: 'var(--metric-disk)' }}
            />
            <span>存储与磁盘 IO</span>
          </h2>
          {ioDetailsAvailable && diskIO ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" aria-label="查看磁盘 IO 细分指标">
                  IO 详情
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" aria-label="磁盘 IO 细分指标">
                <dl className="space-y-2 text-(length:--text-xs) tabular-nums">
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-text-secondary">读取 IOPS</dt>
                    <dd>{diskIO.read_iops != null ? diskIO.read_iops.toFixed(1) : '未知'}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-text-secondary">写入 IOPS</dt>
                    <dd>{diskIO.write_iops != null ? diskIO.write_iops.toFixed(1) : '未知'}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-text-secondary">加权等待</dt>
                    <dd>{diskIO.await_ms != null ? `${diskIO.await_ms.toFixed(2)} ms` : '未知'}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-text-secondary">最高利用率</dt>
                    <dd>
                      {diskIO.util_percent != null ? `${diskIO.util_percent.toFixed(1)}%` : '未知'}
                    </dd>
                  </div>
                  {diskIO.quality.length > 0 && (
                    <div className="border-t-[1px] border-border pt-2 text-warning">
                      部分磁盘采样尚未建立基线
                    </div>
                  )}
                </dl>
              </PopoverContent>
            </Popover>
          ) : (
            <span className="text-(length:--text-xs) text-text-secondary">
              {full?.disk_total ? decimalBytes(full.disk_total) : 'IO 未知'}
            </span>
          )}
        </div>

        <div className="space-y-1">
          <p className="text-(length:--text-2xl) font-medium text-foreground tabular-nums">
            {diskPercent !== undefined ? (
              <AnimatedCounter value={diskPercent} decimals={1} suffix="%" />
            ) : (
              '未知'
            )}
          </p>
          <p className="min-h-4 text-(length:--text-xs) text-text-secondary tabular-nums">
            {!full
              ? node.full
                ? '磁盘采样已过期'
                : '等待磁盘采样'
              : full.disk_used != null && full.disk_total != null
                ? `${decimalBytes(full.disk_used)} / ${decimalBytes(full.disk_total)}`
                : '磁盘容量未知'}
          </p>
        </div>

        <div className="space-y-1.5 pt-1">
          <UsageBar value={diskPercent} label="文件系统使用率" />
          <div className="flex items-center justify-between gap-2 text-(length:--text-xs) text-text-secondary tabular-nums">
            <span>{diskIO ? `读 ${byteRate(diskIO.read_bytes_per_second)}` : '读未知'}</span>
            <span>{diskIO ? `写 ${byteRate(diskIO.write_bytes_per_second)}` : '写未知'}</span>
          </div>
        </div>
      </article>
    </section>
  );
}
