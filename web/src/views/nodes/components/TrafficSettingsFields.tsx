import type { TelemetryFast } from '@/api/telemetry';
import { decimalBytes } from '@/api/telemetry';
import {
  billableTraffic,
  defaultTrafficSettings,
  gbToBytes,
  isTrafficSettings,
  type TrafficSettings,
} from '@/api/traffic';
import { Button } from '@/components/arc/button/button';
import { Input } from '@/components/arc/input/input';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';

export type TrafficValues = {
  interfaces: string;
  day: string;
  time: string;
  timezone: string;
  quota: string;
  billing: TrafficSettings['billing_mode'];
};

export function trafficValues(settings = defaultTrafficSettings): TrafficValues {
  return {
    interfaces: settings.interfaces,
    day: String(settings.reset_day),
    time: `${String(settings.reset_hour).padStart(2, '0')}:${String(settings.reset_minute).padStart(2, '0')}`,
    timezone: settings.timezone,
    quota: String(Number(settings.quota_bytes) / 1000000000),
    billing: settings.billing_mode,
  };
}

export function trafficSettings(
  values: TrafficValues,
  previous?: TrafficSettings,
): TrafficSettings {
  const [hour, minute] = values.time.split(':').map(Number);
  const next: TrafficSettings = {
    interfaces: [
      ...new Set(
        values.interfaces
          .split(',')
          .map((n) => n.trim())
          .filter(Boolean),
      ),
    ]
      .sort()
      .join(','),
    reset_day: Number(values.day),
    reset_hour: hour,
    reset_minute: minute,
    timezone: values.timezone.trim(),
    billing_mode: values.billing,
    quota_bytes:
      previous && values.quota === trafficValues(previous).quota
        ? previous.quota_bytes
        : gbToBytes(values.quota),
  };
  if (!/^\d+$/.test(values.day) || !/^\d{2}:\d{2}$/.test(values.time) || !isTrafficSettings(next))
    throw new Error('请核对网卡名称、每月 1–31 日的重置日期、时间和 IANA 时区。');
  return next;
}

const billingOptions = [
  { value: 'both', label: '双向（RX + TX）' },
  { value: 'outbound', label: '仅上行（TX）' },
  { value: 'inbound', label: '仅下行（RX）' },
];

export default function TrafficSettingsFields({
  values,
  onChange,
  traffic,
  disabled = false,
}: {
  values: TrafficValues;
  onChange: (v: TrafficValues) => void;
  traffic?: TelemetryFast['traffic'];
  disabled?: boolean;
}) {
  const set = (key: keyof TrafficValues, value: string) => onChange({ ...values, [key]: value });

  const used = billableTraffic(traffic?.rx_bytes, traffic?.tx_bytes, values.billing);
  const quotaGB = Number(values.quota);
  const validQuota = values.quota.trim() !== '' && Number.isFinite(quotaGB) && quotaGB >= 0;
  const usedGB = used === undefined ? undefined : Number(used) / 1e9;
  const ratio = validQuota && quotaGB > 0 && usedGB !== undefined ? usedGB / quotaGB : undefined;
  const rx = values.billing === 'outbound' ? 0 : Number(traffic?.rx_bytes ?? 0);
  const tx = values.billing === 'inbound' ? 0 : Number(traffic?.tx_bytes ?? 0);
  const fill = ratio !== undefined ? Math.min(ratio, 1) * 100 : rx + tx > 0 ? 100 : 0;
  const rxWidth = rx + tx > 0 ? (fill * rx) / (rx + tx) : 0;
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-6">
      <div className="min-w-0 space-y-2">
        <p className="text-(length:--text-sm) font-medium text-text-muted">流量计费方式</p>
        <div className="max-w-full overflow-x-auto">
          <SegmentedControl
            label="流量计费方式"
            options={billingOptions}
            value={values.billing}
            onValueChange={(value) => {
              if (!disabled) set('billing', value);
            }}
          />
        </div>
      </div>
      <div className="grid min-w-0 items-start gap-6 md:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <Input
            label="统计网卡"
            value={values.interfaces}
            onChange={(e) => set('interfaces', e.target.value)}
            placeholder="eth0,eth1"
            description="多个网卡以逗号分隔；留空使用默认过滤规则。"
          />
          <Button
            type="button"
            variant="ghost"
            disabled={disabled || !values.interfaces}
            onClick={() => set('interfaces', '')}
          >
            使用默认网卡
          </Button>
        </div>
        <Input
          label="每周期流量额度（GB）"
          inputMode="decimal"
          value={values.quota}
          onChange={(e) => set('quota', e.target.value)}
          description="0 表示未设额度，仅用于用量提示，不限制流量。"
        />
      </div>
      <div className="grid min-w-0 items-start gap-4 border-t border-border pt-6 sm:grid-cols-3">
        <Input
          label="每月重置日期"
          type="number"
          min={1}
          max={31}
          step={1}
          value={values.day}
          onChange={(e) => set('day', e.target.value)}
          description="1–31 日，月份天数不足时取末日。"
        />
        <Input
          label="重置时间"
          type="time"
          value={values.time}
          onChange={(e) => set('time', e.target.value)}
        />
        <Input
          label="计费时区"
          value={values.timezone}
          onChange={(e) => set('timezone', e.target.value)}
          description="例如 UTC、Asia/Shanghai。"
        />
      </div>
      <div className="space-y-3 border-t border-border pt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h4 className="font-medium">用量预览</h4>
          <p className="tabular-nums text-text-secondary">
            <span className="text-(length:--text-lg) font-medium text-foreground">
              {decimalBytes(used?.toString())}
            </span>{' '}
            / {validQuota ? (quotaGB > 0 ? `${values.quota} GB` : '未设置额度') : '额度待填写'}
          </p>
        </div>
        <svg
          viewBox="0 0 100 1"
          preserveAspectRatio="none"
          className="h-2.5 w-full overflow-hidden rounded-full"
          role="img"
          aria-label={
            used === undefined
              ? '流量未知'
              : ratio !== undefined
                ? `已使用 ${(ratio * 100).toFixed(1)}%`
                : '计费流量收发占比'
          }
        >
          <title>按当前计费方式预览流量</title>
          <rect width="100" height="1" fill="var(--usage-track)" />
          {used !== undefined && validQuota && (
            <>
              <rect
                width={rxWidth}
                height="1"
                fill={ratio !== undefined && ratio > 1 ? 'var(--danger)' : 'var(--accent)'}
              />
              <rect
                x={rxWidth}
                width={fill - rxWidth}
                height="1"
                fill={ratio !== undefined && ratio > 1 ? 'var(--danger)' : 'var(--series-1)'}
              />
            </>
          )}
        </svg>
        <div className="flex flex-wrap justify-between gap-3 text-(length:--text-xs) tabular-nums">
          <div className="flex flex-wrap gap-4">
            <span className="text-accent">接收（RX） {decimalBytes(traffic?.rx_bytes)}</span>
            <span style={{ color: 'var(--series-1)' }}>
              发送（TX） {decimalBytes(traffic?.tx_bytes)}
            </span>
          </div>
          <span
            className={ratio !== undefined && ratio > 1 ? 'text-danger' : 'text-text-secondary'}
          >
            {ratio !== undefined && usedGB !== undefined
              ? ratio > 1
                ? `已超出 ${(usedGB - quotaGB).toFixed(2)} GB`
                : `剩余 ${(quotaGB - usedGB).toFixed(2)} GB`
              : used === undefined
                ? '等待有效流量数据'
                : '未设置额度'}
          </span>
        </div>
        <p className="text-(length:--text-xs) text-text-secondary">
          按当前计费方向与额度预览；网卡和账期变更需保存并由节点应用后生效。
        </p>
      </div>
    </fieldset>
  );
}
