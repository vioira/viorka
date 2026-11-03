import {
  defaultTrafficSettings,
  gibToBytes,
  isTrafficSettings,
  type TrafficSettings,
} from '@/api/traffic';
import { Input } from '@/components/arc/input/input';
import { RadioGroup } from '@/components/arc/radio-group/radio-group';

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
export default function TrafficSettingsFields({
  values,
  onChange,
}: {
  values: TrafficValues;
  onChange: (v: TrafficValues) => void;
}) {
  const set = (key: keyof TrafficValues, value: string) => onChange({ ...values, [key]: value });
  return (
    <>
      <div className="min-w-0 space-y-2 sm:col-span-2">
        <h3 className="font-medium">流量统计与计费</h3>
        <p className="text-(length:--text-xs) text-text-secondary">
          网卡修改后重新建立基线，保留已累计流量。重置周期修改从下一周期生效。
        </p>
      </div>
      <Input
        label="统计网卡"
        value={values.interfaces}
        onChange={(e) => set('interfaces', e.target.value)}
        placeholder="eth0,eth1"
        description="英文逗号分隔；留空汇总系统默认过滤后的全部网卡。"
      />
      <Input
        label="每月重置日期"
        type="number"
        min={1}
        max={31}
        step={1}
        value={values.day}
        onChange={(e) => set('day', e.target.value)}
        description="1–31 日；当月不存在该日期时取最后一天。"
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
      <Input
        label="每周期流量额度（GiB）"
        inputMode="decimal"
        value={values.quota}
        onChange={(e) => set('quota', e.target.value)}
        description="0 表示不设置额度；仅用于展示，不自动限速或停机。"
      />
      <RadioGroup
        label="流量计费方式"
        name="traffic_billing"
        value={values.billing}
        onValueChange={(v) => set('billing', v)}
        options={[
          { value: 'both', label: '上行 + 下行', description: '默认，发送与接收之和。' },
          { value: 'outbound', label: '仅上行（出站）' },
          { value: 'inbound', label: '仅下行（入站）' },
        ]}
      />
    </>
  );
}
