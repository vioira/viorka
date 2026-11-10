import { ArrowDown, ArrowUp, CircleAlert, Settings2, SlidersHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { MonitoringSnapshot } from '@/api/monitoring';
import { nodeTime } from '@/api/nodes';
import type { TelemetryInterface } from '@/api/telemetry';
import { decimalBytes, type TelemetrySnapshot, telemetryStale } from '@/api/telemetry';
import { billableTraffic, defaultTrafficSettings } from '@/api/traffic';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';
import { Switch } from '@/components/arc/switch/switch';
import DataTable, { type DataColumn } from '@/components/data-table';
import { byteRate } from './metric-chart';
import NodeMetricHistory from './NodeMetricHistory';
import { telemetryChartPoints, telemetryCharts } from './telemetry-chart';

const qualities: Record<string, string> = {
  baseline: '刚建立基线',
  partial: '数据不完整',
  counter_reset: '计数器已重置',
  identity_changed: '网卡身份变化',
  period_gap: '存在采集间隔',
  boundary_estimated: '周期边界存在未计入流量',
  mixed_filter: '网卡过滤规则已变化',
  persist_failed: '本地保存失败',
  unknown: '未知',
};
// Arc folds table rows into compact mobile records. Keep each measurement named.
function deviceColumns<T extends Record<string, unknown>>(
  columns: DataColumn<T>[],
): DataColumn<T>[] {
  return columns.map((column, index) => ({
    ...column,
    sortable: index === 0,
    render: (value, row) => (
      <span className="tabular-nums wrap-anywhere">
        {index > 0 && <span className="sm:hidden">{column.label}：</span>}
        {column.render ? column.render(value, row) : String(value ?? '未知')}
      </span>
    ),
  }));
}
export default function TelemetryMonitoring({
  id,
  active,
  connectionState,
  snapshot,
  telemetry,
  now,
}: {
  id: string;
  active: boolean;
  connectionState?: string;
  snapshot: MonitoringSnapshot;
  telemetry: TelemetrySnapshot;
  now: number;
}) {
  const [exact, setExact] = useState(false);
  const [hideIdle, setHideIdle] = useState(false);
  const [params, setParams] = useSearchParams();
  function openSettings(target: string) {
    const next = new URLSearchParams(params);
    next.set('tab', 'settings');
    setParams(next);
    requestAnimationFrame(() =>
      document.getElementById(target)?.scrollIntoView({ block: 'start' }),
    );
  }
  const control = snapshot.telemetry_control;
  const staleFast = telemetryStale(telemetry, 'fast', now, control);
  const fast = staleFast ? undefined : telemetry.fast;
  const traffic = fast?.errors.includes('traffic_unavailable') ? undefined : fast?.traffic;
  const billing = telemetry.settings?.traffic ?? defaultTrafficSettings;
  const used = telemetry.settings
    ? billableTraffic(traffic?.rx_bytes, traffic?.tx_bytes, billing.billing_mode)
    : undefined;
  const quota = BigInt(billing.quota_bytes);
  const progress =
    used === undefined || quota === 0n ? undefined : Number((used * 10000n) / quota) / 100;
  const charts = useMemo(() => telemetryCharts(telemetry, now, control), [telemetry, now, control]);
  const points = useMemo(() => telemetryChartPoints(telemetry), [telemetry]);
  const quality = (values?: string[]) =>
    values?.length ? values.map((q) => qualities[q] ?? q).join('，') : '未报告异常';
  const interfaces = fast?.errors.includes('network_unavailable') ? undefined : fast?.interfaces;
  const visibleInterfaces =
    interfaces?.filter(
      (i) =>
        !hideIdle ||
        i.rx_bytes_per_second !== 0 ||
        i.tx_bytes_per_second !== 0 ||
        i.quality.length > 0,
    ) ?? [];
  const total =
    traffic?.rx_bytes !== undefined && traffic?.tx_bytes !== undefined
      ? BigInt(traffic.rx_bytes) + BigInt(traffic.tx_bytes)
      : undefined;
  const rxShare =
    total && traffic?.rx_bytes !== undefined
      ? Number((BigInt(traffic.rx_bytes) * 1000n) / total) / 10
      : undefined;
  const barTotal = quota > 0n ? used : total;
  const fill = quota > 0n ? Math.min(progress ?? 0, 100) : total ? 100 : 0;
  const rxFraction =
    quota > 0n && billing.billing_mode === 'outbound'
      ? 0
      : quota > 0n && billing.billing_mode === 'inbound'
        ? 1
        : (rxShare ?? 0) / 100;
  const rxWidth = fill * rxFraction;
  const txWidth = fill - rxWidth;
  const qualityColor = traffic?.quality.some((q) => ['counter_reset', 'persist_failed'].includes(q))
    ? 'var(--danger)'
    : traffic?.quality.length
      ? 'var(--warning)'
      : 'var(--text-secondary)';
  const remainingDays =
    traffic?.period_end && now > 0
      ? Math.ceil((Date.parse(traffic.period_end) - now) / 86400000)
      : undefined;
  const counter = (value: string) =>
    exact ? `${BigInt(value).toLocaleString()} B` : decimalBytes(value);
  return (
    <section aria-label="主机监控" className="space-y-4">
      <NodeMetricHistory
        id={id}
        active={active}
        connectionState={connectionState}
        points={points}
        currentCharts={charts}
      />
      <section className="v-card space-y-6 text-foreground" aria-label="本周期流量">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="v-card-title">本周期流量</h3>
            <span className="text-(length:--text-xs) text-text-secondary">
              {telemetry.settings
                ? {
                    both: '双向计费（RX + TX）',
                    outbound: '仅上行（TX）',
                    inbound: '仅下行（RX）',
                  }[billing.billing_mode]
                : '计费设置未知'}
            </span>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="ghost" style={{ color: qualityColor }}>
                  <span
                    className="inline-flex items-center gap-1 rounded border px-2 py-1 text-(length:--text-xs)"
                    style={{
                      borderColor: qualityColor,
                      background: traffic?.quality.length
                        ? 'var(--warning-muted)'
                        : 'var(--surface-muted)',
                    }}
                  >
                    <CircleAlert size={14} aria-hidden="true" />
                    {traffic ? quality(traffic.quality) : '数据未知'}
                  </span>
                </Button>
              </DialogTrigger>
              <DialogContent
                title="流量数据质量"
                description={traffic ? quality(traffic.quality) : '等待有效快速采样'}
              >
                <p className="text-text-secondary">
                  累计值来自配置网卡的有效采样。采集间隔、计数器重置或过滤规则变化会影响统计完整性。
                </p>
              </DialogContent>
            </Dialog>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => openSettings('traffic-calibration')}>
              <SlidersHorizontal size={16} aria-hidden="true" />
              校准流量
            </Button>
            <Button variant="secondary" onClick={() => openSettings('traffic-settings')}>
              <Settings2 size={16} aria-hidden="true" />
              额度设置
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-baseline gap-3 tabular-nums">
          <span className="text-(length:--text-xs) text-text-secondary">当前计费用量</span>
          <strong className="text-(length:--text-2xl) font-medium">
            {decimalBytes(used?.toString())}
          </strong>
          <span className="text-text-secondary">
            /{' '}
            {!telemetry.settings
              ? '额度未知'
              : quota === 0n
                ? '未设置额度'
                : decimalBytes(billing.quota_bytes)}
          </span>
          {progress !== undefined && (
            <span className={progress > 100 ? 'text-danger' : 'text-text-secondary'}>
              {progress > 100 ? '已超额' : '已使用'} {progress.toFixed(1)}%
            </span>
          )}
        </div>
        <div className="space-y-2">
          <svg
            viewBox="0 0 100 1"
            preserveAspectRatio="none"
            className="h-2.5 w-full overflow-hidden rounded-full"
            role="img"
            aria-label={
              barTotal === undefined
                ? '流量比例未知'
                : quota > 0n
                  ? `已使用 ${progress?.toFixed(1)}%`
                  : `接收占比 ${rxShare ?? 0}%，发送占比 ${total ? 100 - (rxShare ?? 0) : 0}%`
            }
          >
            <title>周期流量分布</title>
            <rect width="100" height="1" fill="var(--usage-track)" />
            {barTotal !== undefined && (
              <>
                <rect
                  width={rxWidth}
                  height="1"
                  fill={
                    progress !== undefined && progress > 100 ? 'var(--danger)' : 'var(--accent)'
                  }
                />
                <rect
                  x={rxWidth}
                  width={txWidth}
                  height="1"
                  fill={
                    progress !== undefined && progress > 100 ? 'var(--danger)' : 'var(--series-1)'
                  }
                />
              </>
            )}
          </svg>
          <div className="flex flex-wrap justify-between gap-2 text-(length:--text-xs) text-text-secondary tabular-nums">
            <div className="flex gap-4">
              <span style={{ color: 'var(--accent)' }}>● 接收（RX）</span>
              <span style={{ color: 'var(--series-1)' }}>● 发送（TX）</span>
            </div>
            <span
              style={{
                color: progress !== undefined && progress > 100 ? 'var(--danger)' : undefined,
              }}
            >
              {used !== undefined && quota > 0n
                ? used > quota
                  ? `已超出 ${decimalBytes((used - quota).toString())}`
                  : `已用 ${progress?.toFixed(1)}%，剩余 ${decimalBytes((quota - used).toString())}`
                : rxShare !== undefined
                  ? `接收占比 ${rxShare.toFixed(1)}%，发送占比 ${(100 - rxShare).toFixed(1)}%（未设置总配额）`
                  : '等待有效流量数据'}
            </span>
          </div>
        </div>
        <dl className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ['累计接收（下行）', traffic?.rx_bytes, 'RX', 'var(--accent)', ArrowDown],
              ['累计发送（上行）', traffic?.tx_bytes, 'TX', 'var(--series-1)', ArrowUp],
            ] as const
          ).map(([label, value, direction, color, Icon]) => (
            <div
              key={label}
              className="flex items-start justify-between gap-3 border border-border bg-surface-raised p-4 rounded-(--radius-control)"
            >
              <div className="min-w-0 space-y-2">
                <dt className="flex items-center gap-2 text-(length:--text-xs) text-text-secondary">
                  <Icon size={16} style={{ color }} aria-hidden="true" />
                  {label}
                </dt>
                <dd className="space-y-1 wrap-anywhere tabular-nums text-(length:--text-lg) font-medium text-foreground">
                  {decimalBytes(value)}
                  {value !== undefined && (
                    <span className="block text-(length:--text-xs) font-normal text-text-secondary">
                      {BigInt(value).toLocaleString()} 字节
                    </span>
                  )}
                </dd>
              </div>
              <span
                className="rounded border px-2 py-1 text-(length:--text-xs)"
                style={{ color, borderColor: color }}
              >
                {direction}
              </span>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-(--radius-control) border border-border bg-surface-muted p-3 text-(length:--text-xs) text-text-secondary tabular-nums">
          <span>周期起点：{traffic ? nodeTime(traffic.month_start) : '未知'}</span>
          <span>下次重置：{traffic?.period_end ? nodeTime(traffic.period_end) : '未知'}</span>
          {remainingDays !== undefined && (
            <span>{remainingDays > 0 ? `剩余 ${remainingDays} 天` : '等待新周期采样'}</span>
          )}
          <span>账期时区：{telemetry.settings ? billing.timezone : '未知'}</span>
        </div>
      </section>
      <section className="v-card space-y-4" aria-label="网卡流量">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h3 className="v-card-title">网卡流量</h3>
            <span className="text-(length:--text-xs) text-text-secondary">
              {interfaces ? `${visibleInterfaces.length} 个网卡` : '等待采样'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex min-h-11 items-center gap-2 text-(length:--text-xs)">
              <Switch checked={hideIdle} onCheckedChange={setHideIdle} label="隐藏闲置网卡" />
            </label>
            <Button variant="ghost" aria-pressed={exact} onClick={() => setExact(!exact)}>
              {exact ? '显示易读单位' : '显示完整字节'}
            </Button>
          </div>
        </div>
        <DataTable
          rows={visibleInterfaces}
          rowKey="name"
          caption="已过滤网卡的当前采样"
          emptyMessage={
            interfaces
              ? hideIdle
                ? '无符合条件的网卡，已隐藏闲置网卡'
                : '当前采样没有网卡'
              : '网卡指标未知，等待有效快速采样'
          }
          columns={deviceColumns<TelemetryInterface>([
            { key: 'name', label: '网卡' },
            {
              key: 'rx_bytes_per_second',
              label: '接收速率',
              render: (_, i) => (
                <span style={{ color: 'var(--accent)' }}>↓ {byteRate(i.rx_bytes_per_second)}</span>
              ),
            },
            {
              key: 'tx_bytes_per_second',
              label: '发送速率',
              render: (_, i) => (
                <span style={{ color: 'var(--series-1)' }}>
                  ↑ {byteRate(i.tx_bytes_per_second)}
                </span>
              ),
            },
            { key: 'rx_bytes', label: '计数器接收', render: (_, i) => counter(i.rx_bytes) },
            { key: 'tx_bytes', label: '计数器发送', render: (_, i) => counter(i.tx_bytes) },
            {
              key: 'quality',
              label: '数据质量',
              render: (_, i) => (
                <span
                  className="rounded px-2 py-1 text-(length:--text-xs)"
                  style={{
                    color: i.quality.length ? 'var(--warning)' : 'var(--text-secondary)',
                    background: i.quality.length ? 'var(--warning-muted)' : 'var(--surface-muted)',
                  }}
                >
                  {quality(i.quality)}
                </span>
              ),
            },
          ])}
        />
      </section>
    </section>
  );
}
