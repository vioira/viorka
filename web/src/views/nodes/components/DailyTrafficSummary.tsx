import { nodeTime } from '@/api/nodes';
import { decimalBytes, type TelemetrySnapshot } from '@/api/telemetry';
import { billableTraffic } from '@/api/traffic';

export default function DailyTrafficSummary({
  telemetry,
  now,
  stale,
}: {
  telemetry: TelemetrySnapshot;
  now: number;
  stale: boolean;
}) {
  const record = telemetry.daily_traffic;
  const daily =
    record && now >= Date.parse(record.day_start) && now < Date.parse(record.day_end)
      ? record
      : undefined;
  const settings = telemetry.settings;
  const mode = settings?.traffic?.billing_mode ?? 'both';
  const used =
    daily && settings ? billableTraffic(daily.rx_bytes, daily.tx_bytes, mode) : undefined;
  const expired =
    daily &&
    (stale ||
      now - Date.parse(daily.sampled_at) >
        ((settings?.http_report_seconds ?? 60) + (settings?.collection_seconds ?? 5) + 15) * 1000);
  const quality = daily
    ? [
        daily.quality & 1 ? '今日数据不完整' : '',
        daily.quality & 2 ? '跨日边界按时间估算' : '',
        daily.quality & 4 ? '统计网卡已变化' : '',
        daily.quality & 8 ? '历史补报存在缺口' : '',
      ]
        .filter(Boolean)
        .join('，')
    : '';
  return (
    <section className="space-y-4 border-b border-border pb-6" aria-label="今日流量">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="v-card-title">今日流量</h3>
        <span className="text-(length:--text-xs) text-text-secondary" role="status">
          {!daily ? '等待今日采样' : expired ? '数据已过期' : '已更新'}
        </span>
      </div>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          ['今日用量', used?.toString()],
          ['今日上行', daily?.tx_bytes],
          ['今日下行', daily?.rx_bytes],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0 space-y-2">
            <dt className="text-(length:--text-xs) text-text-secondary">{label}</dt>
            <dd
              className="wrap-anywhere text-(length:--text-lg) font-medium tabular-nums"
              title={value ? `${value} B` : undefined}
            >
              {value === undefined ? '未知' : decimalBytes(value)}
            </dd>
          </div>
        ))}
      </dl>
      <div className="min-h-5 space-y-1 text-(length:--text-xs) text-text-secondary">
        {daily && (
          <p>
            统计区间：{nodeTime(daily.day_start)} 至 {nodeTime(daily.day_end)}；采样于{' '}
            {nodeTime(daily.sampled_at)}
          </p>
        )}
        {quality && <p>{quality}</p>}
      </div>
    </section>
  );
}
