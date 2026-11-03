import { useMemo } from 'react';
import type { MonitoringSnapshot } from '@/api/monitoring';
import { nodeTime } from '@/api/nodes';
import type { TelemetryInterface } from '@/api/telemetry';
import { decimalBytes, type TelemetrySnapshot, telemetryStale } from '@/api/telemetry';
import { Button } from '@/components/arc/button/button';
import DataTable, { type DataColumn } from '@/components/data-table';
import { byteRate } from './metric-chart';
import NodeMetricHistory from './NodeMetricHistory';
import { telemetryChartPoints, telemetryCharts } from './telemetry-chart';

const modes = {
  http: 'HTTP 定期上报',
  pending: '实时请求待确认',
  realtime: 'WSS 实时上报',
  degraded: '实时模式降级',
};
const qualities: Record<string, string> = {
  baseline: '刚建立基线',
  partial: '数据不完整',
  counter_reset: '计数器已重置',
  identity_changed: '网卡身份变化',
  period_gap: '存在采集间隔',
  boundary_estimated: '月界按估算拆分',
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
  connection,
  onRefresh,
}: {
  id: string;
  active: boolean;
  snapshot: MonitoringSnapshot;
  telemetry: TelemetrySnapshot;
  now: number;
  connection: string;
  onRefresh: () => void;
}) {
  const control = snapshot.telemetry_control;
  const staleFast = telemetryStale(telemetry, 'fast', now, control);
  const staleFull = telemetryStale(telemetry, 'full', now, control);
  const fast = staleFast ? undefined : telemetry.fast;
  const full = staleFull ? undefined : telemetry.full;
  const traffic = fast?.errors.includes('traffic_unavailable') ? undefined : fast?.traffic;
  const charts = useMemo(() => telemetryCharts(telemetry, now, control), [telemetry, now, control]);
  const points = useMemo(() => telemetryChartPoints(telemetry), [telemetry]);
  const quality = (values?: string[]) =>
    values?.length ? values.map((q) => qualities[q] ?? q).join('，') : '未报告异常';
  return (
    <section aria-label="主机监控" className="space-y-4 border-t-[0.5px] border-border pt-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-medium">主机监控</h2>
        <Button variant="ghost" className="min-h-11" onClick={onRefresh}>
          重新同步监控
        </Button>
      </div>
      <p role="status" className="min-h-10 text-text-secondary">
        管理连接：
        {snapshot.management_online === undefined
          ? '未知'
          : snapshot.management_online
            ? '在线'
            : '离线'}
        。 上报模式：{control ? modes[control.mode] : '未知'}。
        {connection !== 'live' && '浏览器实时推送未同步，已有采样保留。'}
      </p>
      <dl className="grid gap-4 sm:grid-cols-3">
        {(['fast', 'full', 'public_ip'] as const).map((group) => (
          <div key={group} className="min-w-0">
            <dt className="text-text-secondary">
              {{ fast: '快速指标', full: '完整指标', public_ip: '公网 IP' }[group]}
            </dt>
            <dd className="mt-1 min-h-5 tabular-nums">
              {!telemetry[group]
                ? '尚未上报'
                : telemetryStale(telemetry, group, now, control)
                  ? '已过期'
                  : telemetry[group].errors.length
                    ? '部分指标不可用'
                    : '有效'}
              <span className="block wrap-anywhere text-(length:--text-xs) text-text-secondary">
                采样：{telemetry[group] ? nodeTime(telemetry[group].sampled_at) : '未知'}
              </span>
              <span className="block wrap-anywhere text-(length:--text-xs) text-text-secondary">
                接收：{telemetry[group] ? nodeTime(telemetry[`${group}_received_at`]) : '未知'}
              </span>
            </dd>
          </div>
        ))}
      </dl>
      <NodeMetricHistory id={id} active={active} points={points} currentCharts={charts} />
      <section className="space-y-3" aria-label="本月流量">
        <h3 className="font-medium">本月流量</h3>
        <p className="text-(length:--text-xs) text-text-secondary">
          UTC 自然月，按网卡过滤规则累计；不代表服务商账单。采集中断与规则变化会影响完整性。
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
          月起点：{traffic ? traffic.month_start : '未知'}。数据质量：
          {traffic ? quality(traffic.quality) : '未知'}。
        </p>
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
