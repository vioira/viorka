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
import { UsageMeter } from '@/components/arc/usage-meter/usage-meter';

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
  const segments = [
    ...(values.billing !== 'outbound' && traffic?.rx_bytes !== undefined
      ? [{ id: 'rx', label: '接收（RX）', value: Number(traffic.rx_bytes) / 1e9 }]
      : []),
    ...(values.billing !== 'inbound' && traffic?.tx_bytes !== undefined
      ? [{ id: 'tx', label: '发送（TX）', value: Number(traffic.tx_bytes) / 1e9 }]
      : []),
  ];
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
          description="0 表示无限额度；额度仅用于用量提示，不限制流量。"
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
        {used !== undefined && validQuota ? (
          <UsageMeter
            label="用量预览"
            segments={segments}
            limit={quotaGB > 0 ? quotaGB : undefined}
            unit="GB"
            decimals={2}
            freeLabel="剩余额度"
            overLabel="超出额度"
          />
        ) : (
          <div className="space-y-2">
            <h4 className="font-medium">用量预览</h4>
            <p className="tabular-nums text-text-secondary">
              {decimalBytes(used?.toString())}
              {' / '}
              {validQuota ? (quotaGB > 0 ? `${values.quota} GB` : '无限额度') : '额度待填写'}
            </p>
            {used === undefined && (
              <p className="text-(length:--text-xs) text-text-secondary">等待有效流量数据</p>
            )}
          </div>
        )}
        <p className="text-(length:--text-xs) text-text-secondary">
          按当前计费方向与额度预览；网卡和账期变更需保存并由节点应用后生效。
        </p>
      </div>
    </fieldset>
  );
}
