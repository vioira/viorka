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
import { UsageMeter } from '@/components/arc/usage-meter/usage-meter';
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
  snapshot,
  telemetry,
  now,
}: {
  id: string;
  active: boolean;
  snapshot: MonitoringSnapshot;
  telemetry: TelemetrySnapshot;
  now: number;
}) {
  const [exact, setExact] = useState(false);
  const [hideIdle, setHideIdle] = useState(false);
  const [params, setParams] = useSearchParams();
  function openSettings() {
    const next = new URLSearchParams(params);
    next.set('tab', 'settings');
    setParams(next);
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
    total && traffic ? Number((BigInt(traffic.rx_bytes!) * 1000n) / total) / 10 : undefined;
  const remainingDays =
    traffic?.period_end && now > 0
      ? Math.ceil((Date.parse(traffic.period_end) - now) / 86400000)
      : undefined;
  const counter = (value: string) =>
    exact ? `${BigInt(value).toLocaleString()} B` : decimalBytes(value);
  return (
    <section aria-label="主机监控" className="space-y-4">
      <NodeMetricHistory id={id} active={active} points={points} currentCharts={charts} />
      <section
        className="space-y-6 rounded-lg border border-border bg-surface p-4 sm:p-6"
        aria-label="本周期流量"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="font-medium">本周期流量</h3>
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
                <Button
                  variant="ghost"
                  className={traffic?.quality.length ? 'text-warning' : 'text-text-secondary'}
                >
                  {traffic ? quality(traffic.quality) : '数据未知'}
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
            <Button variant="secondary" onClick={openSettings}>
              校准流量
            </Button>
            <Button variant="secondary" onClick={openSettings}>
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
        <dl className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ['累计接收', traffic?.rx_bytes],
              ['累计发送', traffic?.tx_bytes],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt className="text-text-secondary">{label}</dt>
              <dd className="min-h-5 wrap-anywhere tabular-nums text-(length:--text-base) font-medium">
                {decimalBytes(value)}
                {value !== undefined && (
                  <span className="block text-(length:--text-xs) text-text-secondary">
                    {BigInt(value).toLocaleString()} 字节
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
        {quota === 0n && rxShare !== undefined && (
          <p className="text-(length:--text-xs) text-text-secondary tabular-nums">
            接收占比 {rxShare.toFixed(1)}%，发送占比 {(100 - rxShare).toFixed(1)}%
          </p>
        )}
        {used !== undefined && quota > 0n && (
          <UsageMeter
            label="周期流量额度"
            unit="GB"
            limit={Number(quota) / 1000000000}
            segments={[
              ...(billing.billing_mode !== 'outbound'
                ? [{ id: 'rx', label: '接收（RX）', value: Number(traffic?.rx_bytes) / 1000000000 }]
                : []),
              ...(billing.billing_mode !== 'inbound'
                ? [{ id: 'tx', label: '发送（TX）', value: Number(traffic?.tx_bytes) / 1000000000 }]
                : []),
            ]}
            freeLabel="剩余额度"
            overLabel="超出额度"
          />
        )}
        {used !== undefined && quota > 0n && (
          <p className="text-(length:--text-xs) text-text-secondary tabular-nums">
            {used > quota
              ? `已超出 ${decimalBytes((used - quota).toString())}`
              : `剩余 ${decimalBytes((quota - used).toString())}`}
          </p>
        )}
        <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-4 text-(length:--text-xs) text-text-secondary tabular-nums">
          <span>周期起点：{traffic ? nodeTime(traffic.month_start) : '未知'}</span>
          <span>下次重置：{traffic?.period_end ? nodeTime(traffic.period_end) : '未知'}</span>
          {remainingDays !== undefined && (
            <span>{remainingDays > 0 ? `剩余 ${remainingDays} 天` : '等待新周期采样'}</span>
          )}
          <span>账期时区：{telemetry.settings ? billing.timezone : '未知'}</span>
        </div>
      </section>
      <section className="space-y-4" aria-label="网卡流量">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h3 className="font-medium">网卡流量</h3>
            <span className="text-(length:--text-xs) text-text-secondary">
              {interfaces ? `${visibleInterfaces.length} 个网卡` : '等待采样'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex min-h-11 items-center gap-2 text-(length:--text-xs)">
              <Switch checked={hideIdle} onCheckedChange={setHideIdle} label="隐藏闲置网卡" />
              隐藏闲置网卡
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
              render: (_, i) => byteRate(i.rx_bytes_per_second),
            },
            {
              key: 'tx_bytes_per_second',
              label: '发送速率',
              render: (_, i) => byteRate(i.tx_bytes_per_second),
            },
            { key: 'rx_bytes', label: '计数器接收', render: (_, i) => counter(i.rx_bytes) },
            { key: 'tx_bytes', label: '计数器发送', render: (_, i) => counter(i.tx_bytes) },
            { key: 'quality', label: '数据质量', render: (_, i) => quality(i.quality) },
          ])}
        />
      </section>
    </section>
  );
}
