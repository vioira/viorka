import type { TelemetryFast } from '@/api/telemetry';
import {
  defaultTrafficSettings,
  gibToBytes,
  isTrafficSettings,
  type TrafficSettings,
} from '@/api/traffic';
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
    quota: String(Number(settings.quota_bytes) / 1073741824),
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
        : gibToBytes(values.quota),
  };
  if (!/^\d+$/.test(values.day) || !/^\d{2}:\d{2}$/.test(values.time) || !isTrafficSettings(next))
    throw new Error('请核对网卡名称、每月 1–31 日的重置日期、时间和 IANA 时区。');
  return next;
}

const billingOptions = [
  { value: 'both', label: '上行 + 下行 (全双工)' },
  { value: 'outbound', label: '仅上行 (出站)' },
  { value: 'inbound', label: '仅下行 (入站)' },
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

  const quotaGiB = parseFloat(values.quota) || 0;
  const rxGiB = traffic?.rx_bytes !== undefined ? Number(traffic.rx_bytes) / 1073741824 : 0;
  const txGiB = traffic?.tx_bytes !== undefined ? Number(traffic.tx_bytes) / 1073741824 : 0;
  const hasUsage = traffic && (rxGiB > 0 || txGiB > 0);

  return (
    <div className="space-y-4">
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Input
            label="统计网卡"
            value={values.interfaces}
            onChange={(e) => set('interfaces', e.target.value)}
            placeholder="eth0,eth1"
            disabled={disabled}
            description="留空汇总系统默认过滤后的全部物理网卡。"
          />
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            <button
              type="button"
              disabled={disabled}
              className="rounded-xs border border-border bg-surface px-2 py-0.5 font-mono text-(length:--text-xs) text-text-secondary hover:text-foreground hover:border-foreground/30 transition-colors cursor-pointer disabled:opacity-50"
              onClick={() => set('interfaces', '')}
            >
              清空为全部网卡
            </button>
            {['eth0', 'eth1', 'ens3'].map((iface) => (
              <button
                key={iface}
                type="button"
                disabled={disabled}
                className="rounded-xs border border-border bg-surface px-2 py-0.5 font-mono text-(length:--text-xs) text-text-secondary hover:text-foreground hover:border-foreground/30 transition-colors cursor-pointer disabled:opacity-50"
                onClick={() => {
                  const current = values.interfaces
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean);
                  if (!current.includes(iface)) {
                    set('interfaces', [...current, iface].join(','));
                  }
                }}
              >
                + {iface}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block text-(length:--text-sm) font-medium text-foreground">
            流量计费方式
          </label>
          <SegmentedControl
            options={billingOptions}
            value={values.billing}
            onValueChange={(val) => set('billing', val as TrafficSettings['billing_mode'])}
          />
          <p className="text-(length:--text-xs) text-text-secondary">
            根据服务商或 VPS 计费规则选择统计方向。
          </p>
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
        <Input
          label="每月重置日期"
          type="number"
          min={1}
          max={31}
          step={1}
          value={values.day}
          disabled={disabled}
          onChange={(e) => set('day', e.target.value)}
          description="1–31 日；月份天数不足时取末日。"
        />

        <Input
          label="重置时间"
          type="time"
          value={values.time}
          disabled={disabled}
          onChange={(e) => set('time', e.target.value)}
          description="账期清零时间点。"
        />

        <div className="space-y-1.5">
          <Input
            label="计费时区"
            value={values.timezone}
            disabled={disabled}
            onChange={(e) => set('timezone', e.target.value)}
            description="例如 UTC、Asia/Shanghai。"
          />
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {['UTC', 'Asia/Shanghai', 'America/New_York'].map((tz) => (
              <button
                key={tz}
                type="button"
                disabled={disabled}
                className="rounded-xs border border-border bg-surface px-2 py-0.5 font-mono text-(length:--text-xs) text-text-secondary hover:text-foreground hover:border-foreground/30 transition-colors cursor-pointer disabled:opacity-50"
                onClick={() => set('timezone', tz)}
              >
                {tz}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-2 pt-2 border-t-[1px] border-border">
        <div className="max-w-xs">
          <Input
            label="每周期流量额度（GiB）"
            inputMode="decimal"
            value={values.quota}
            disabled={disabled}
            onChange={(e) => set('quota', e.target.value)}
            description="0 表示不设置限额；仅用于可视化预警，不强制限速。"
          />
        </div>

        {/* 本期累计消耗进度卡片 */}
        <div className="mt-4 rounded-lg border border-border bg-surface-muted/30 p-4 space-y-2.5">
          <div className="flex items-center justify-between text-(length:--text-xs)">
            <span className="font-medium text-foreground">本期累计消耗进度</span>
            <span className="font-mono tabular-nums text-text-secondary">
              {quotaGiB > 0
                ? `${(txGiB + rxGiB).toFixed(2)} GiB / ${quotaGiB.toFixed(2)} GiB (${(((txGiB + rxGiB) / quotaGiB) * 100).toFixed(1)}%)`
                : `${(txGiB + rxGiB).toFixed(2)} GiB / 无限额`}
            </span>
          </div>

          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted flex">
            {quotaGiB > 0 ? (
              <>
                <div
                  className="bg-[#3b82f6] h-full transition-all duration-300"
                  style={{ width: `${Math.min(100, (txGiB / quotaGiB) * 100)}%` }}
                />
                <div
                  className="bg-[#10b981] h-full transition-all duration-300"
                  style={{
                    width: `${Math.min(
                      Math.max(0, 100 - (txGiB / quotaGiB) * 100),
                      (rxGiB / quotaGiB) * 100,
                    )}%`,
                  }}
                />
              </>
            ) : txGiB + rxGiB > 0 ? (
              <>
                <div
                  className="bg-[#3b82f6] h-full transition-all duration-300"
                  style={{ width: `${(txGiB / (txGiB + rxGiB)) * 50}%` }}
                />
                <div
                  className="bg-[#10b981] h-full transition-all duration-300"
                  style={{ width: `${(rxGiB / (txGiB + rxGiB)) * 50}%` }}
                />
              </>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-4 text-[11px] text-text-secondary pt-0.5">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-xs bg-[#3b82f6] inline-block" />
              <span>
                上行已用:{' '}
                <strong className="font-medium text-foreground tabular-nums">
                  {txGiB.toFixed(2)} GiB
                </strong>
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-xs bg-[#10b981] inline-block" />
              <span>
                下行已用:{' '}
                <strong className="font-medium text-foreground tabular-nums">
                  {rxGiB.toFixed(2)} GiB
                </strong>
              </span>
            </div>
            <div className="ml-auto text-text-secondary">
              剩余额度:{' '}
              <span className="tabular-nums">
                {quotaGiB > 0
                  ? `${Math.max(0, quotaGiB - (txGiB + rxGiB)).toFixed(2)} GiB`
                  : '不受限'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
