import { useMemo } from 'react';
import type { MonitoringSnapshot } from '@/api/monitoring';
import { nodeTime } from '@/api/nodes';
import type { TelemetryInterface } from '@/api/telemetry';
import { decimalBytes, type TelemetrySnapshot, telemetryStale } from '@/api/telemetry';
import { billableTraffic, defaultTrafficSettings } from '@/api/traffic';
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
  const control = snapshot.telemetry_control;
  const staleFast = telemetryStale(telemetry, 'fast', now, control);
  const fast = staleFast ? undefined : telemetry.fast;
  const traffic = fast?.errors.includes('traffic_unavailable') ? undefined : fast?.traffic;
  const billing = telemetry.settings?.traffic ?? defaultTrafficSettings;
  const used = billableTraffic(traffic?.rx_bytes, traffic?.tx_bytes, billing.billing_mode);
  const quota = BigInt(billing.quota_bytes);
  const progress =
    used === undefined || quota === 0n ? undefined : Number((used * 10000n) / quota) / 100;
  const charts = useMemo(() => telemetryCharts(telemetry, now, control), [telemetry, now, control]);
  const points = useMemo(() => telemetryChartPoints(telemetry), [telemetry]);
  const quality = (values?: string[]) =>
    values?.length ? values.map((q) => qualities[q] ?? q).join('，') : '未报告异常';
  return (
    <section aria-label="主机监控" className="space-y-4">
      <NodeMetricHistory id={id} active={active} points={points} currentCharts={charts} />
      <section className="space-y-3" aria-label="本周期流量">
        <h3 className="font-medium">本周期流量</h3>
        <p className="text-(length:--text-xs) text-text-secondary">
          计费方式：
          {
            { both: '上行 + 下行', outbound: '仅上行（出站）', inbound: '仅下行（入站）' }[
              billing.billing_mode
            ]
          }
          。按配置网卡累计，不代表服务商账单。
        </p>
        <dl className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ['累计接收', traffic?.rx_bytes],
              ['累计发送', traffic?.tx_bytes],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt className="text-text-secondary">{label}</dt>
              <dd className="min-h-5 wrap-anywhere tabular-nums">
                {decimalBytes(value)}
                {value !== undefined && (
                  <span className="block text-(length:--text-xs) text-text-secondary">
                    {value} 字节
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
        <p className="wrap-anywhere text-(length:--text-xs) text-text-secondary">
          周期起点：{traffic ? traffic.month_start : '未知'}。数据质量：
          {traffic ? quality(traffic.quality) : '未知'}。下次重置：
          {traffic?.period_end ? nodeTime(traffic.period_end) : '未知'}。
        </p>
        <p className="min-h-5 tabular-nums">
          计费用量：{decimalBytes(used?.toString())} /{' '}
          {quota === 0n ? '未设置额度' : decimalBytes(billing.quota_bytes)}。
          {progress !== undefined && `使用 ${progress.toFixed(2)}%`}
        </p>
        {used !== undefined && quota > 0n && (
          <UsageMeter
            label="周期流量额度"
            unit="GiB"
            limit={Number(quota) / 1073741824}
            segments={[{ id: 'used', label: '计费用量', value: Number(used) / 1073741824 }]}
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
      </section>
      <section className="space-y-3" aria-label="网卡流量">
        <h3 className="font-medium">网卡流量</h3>
        <DataTable
          rows={fast?.errors.includes('network_unavailable') ? [] : (fast?.interfaces ?? [])}
          rowKey="name"
          caption="已过滤网卡的当前采样"
          emptyMessage="网卡指标未知，等待有效快速采样"
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
            { key: 'rx_bytes', label: '计数器接收', render: (_, i) => decimalBytes(i.rx_bytes) },
            { key: 'tx_bytes', label: '计数器发送', render: (_, i) => decimalBytes(i.tx_bytes) },
            { key: 'quality', label: '数据质量', render: (_, i) => quality(i.quality) },
          ])}
        />
      </section>
    </section>
  );
}
