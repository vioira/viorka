import { memo, useState } from 'react';
import { nodeTime } from '@/api/nodes';
import type { TCPProbe } from '@/api/telemetry';
import { Button } from '@/components/arc/button/button';
import { Tooltip } from '@/components/arc/tooltip/tooltip';

type Metric = 'ping' | 'loss';
export const timeFormat = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
export const dateTimeFormat = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
export const metrics = [
  { key: 'ping', label: '延迟', unit: 'ms' },
  { key: 'loss', label: '丢包率', unit: '%' },
] as const;
function tone(value: number | undefined, metric: Metric) {
  if (value === undefined) return 'unknown';
  if (metric === 'ping') {
    if (value === -1 || value >= 300) return 'poor';
    if (value >= 200) return 'poor-light';
    if (value >= 150) return 'fair';
    if (value >= 100) return 'fair-light';
    return value > 50 ? 'good-light' : 'good';
  }
  if (value >= 33) return 'poor';
  if (value >= 20) return 'poor-light';
  if (value >= 10) return 'fair';
  if (value >= 5) return 'fair-light';
  return value > 0 ? 'good-light' : 'good';
}
export function valueText(probe: Pick<TCPProbe, Metric>, metric: Metric) {
  const value = probe[metric];
  if (metric === 'ping' && value === -1) return '--';
  return metric === 'loss' ? String(Number(value.toFixed(1))) : value.toFixed(1);
}

type ProbeSlot = { start: number; end: number; point?: Pick<TCPProbe, Metric> };
export function TCPProbeRow({
  name,
  probe,
  slots,
  period,
  loaded,
}: {
  name: string;
  probe?: Pick<TCPProbe, Metric>;
  slots: ProbeSlot[];
  period: number;
  loaded: boolean;
}) {
  return (
    <li className="grid min-w-0 grid-cols-2 gap-x-4">
      {metrics.map(({ key, label, unit }) => {
        const color = tone(probe?.[key], key);
        return (
          <div key={key} className="min-w-0">
            <div className="flex min-h-7 in-[.status-node-card]:min-h-5 flex-wrap items-baseline justify-between gap-x-2">
              {key === 'ping' ? (
                <span className="min-w-0 text-(length:--text-sm) font-medium wrap-anywhere">
                  {name}
                </span>
              ) : (
                <span className="sr-only">{label}</span>
              )}
              <span
                className="ml-auto shrink-0 text-(length:--text-sm) font-medium tabular-nums"
                style={{ color: `var(--probe-${color}-text)` }}
              >
                {!probe ? '未知' : valueText(probe, key)}
                {probe && probe[key] >= 0 && (
                  <span className="ml-1 text-(length:--text-xs) font-normal text-text-secondary">
                    {unit}
                  </span>
                )}
              </span>
            </div>
            <Timeline
              slots={slots}
              name={name}
              metric={key}
              label={label}
              unit={unit}
              period={period}
              loaded={loaded}
            />
          </div>
        );
      })}
    </li>
  );
}
// One interactive trigger per timeline; the individual samples are lightweight chart marks.
const TimelineMarks = memo(function TimelineMarks({
  colors,
  selected,
}: {
  colors: string;
  selected?: number;
}) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-1/2 flex h-4 in-[.status-node-card]:h-2.5 in-[.status-node-card]:gap-0.5 -translate-y-1/2 gap-1"
      aria-hidden="true"
    >
      {colors.split(',').map((entry, index) => {
        const [bucket, color] = entry.split(':');
        return (
          <span
            key={bucket}
            data-selected={selected === index || undefined}
            className="min-w-0 flex-1 rounded-xs group-data-[tcp-active=true]/tcp-timeline:[&:not([data-selected=true])]:opacity-(--probe-inactive-opacity) data-[selected=true]:relative data-[selected=true]:z-10 data-[selected=true]:scale-110 motion-reduce:data-[selected=true]:scale-100"
            style={{ background: `var(--probe-${color}-fill)` }}
          />
        );
      })}
    </div>
  );
});

function Timeline({
  slots,
  name,
  metric,
  label,
  unit,
  period,
  loaded,
}: {
  slots: ProbeSlot[];
  name: string;
  metric: Metric;
  label: string;
  unit: string;
  period: number;
  loaded: boolean;
}) {
  const [selected, setSelected] = useState<number>();
  const [width, setWidth] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const active = hovered || focused;
  const displayed = slots;
  const selectedIndex = displayed.findIndex((slot) => slot.start === selected);
  const index = selectedIndex < 0 ? displayed.length - 1 : selectedIndex;
  const slot = displayed[index];
  if (!slot) return <div className="h-(--control-height-md)" />;
  const { start: bucket, point } = slot;
  const bucketLabel = `${nodeTime(new Date(bucket * 1000).toISOString())} 至 ${nodeTime(new Date(slot.end * 1000).toISOString())}`;
  const format = period >= 3600 ? dateTimeFormat : timeFormat;
  const timeLabel = `${format.format(bucket * 1000)} - ${format.format(slot.end * 1000)}`;
  const selectAt = (event: React.PointerEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setWidth(rect.width);
    setHovered(true);
    setSelected(
      displayed[
        Math.max(
          0,
          Math.min(
            displayed.length - 1,
            Math.floor(((event.clientX - rect.left) / rect.width) * displayed.length),
          ),
        )
      ].start,
    );
  };
  return (
    <div
      className="group/tcp-timeline relative min-w-0"
      data-tcp-timeline
      data-tcp-active={active || undefined}
    >
      <Tooltip
        openOnClick
        anchorOffset={((width + 4) * (index + 0.5)) / displayed.length - 2}
        content={
          <div className="flex flex-wrap items-baseline gap-x-3 tabular-nums">
            <span>{timeLabel}</span>
            <span>
              {point
                ? `${valueText(point, metric)}${point[metric] >= 0 ? ` ${unit}` : ''}`
                : loaded
                  ? '无探测数据'
                  : '历史尚未读取'}
            </span>
          </div>
        }
      >
        <Button
          variant="ghost"
          className="w-full min-w-0 bg-transparent! in-[.status-node-card]:h-4! in-[.status-node-card]:min-h-4! in-[.status-node-card]:p-0!"
          onFocus={(event) => {
            setWidth(event.currentTarget.getBoundingClientRect().width);
            setFocused(event.currentTarget.matches(':focus-visible'));
          }}
          onBlur={() => setFocused(false)}
          onPointerEnter={selectAt}
          onPointerLeave={() => setHovered(false)}
          onPointerMove={selectAt}
          onPointerDown={selectAt}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setHovered(false);
              setFocused(false);
            }
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            setFocused(true);
            event.preventDefault();
            setSelected(
              displayed[
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? displayed.length - 1
                    : Math.max(
                        0,
                        Math.min(
                          displayed.length - 1,
                          index + (event.key === 'ArrowRight' ? 1 : -1),
                        ),
                      )
              ].start,
            );
          }}
          aria-label={`${name}，${bucketLabel}，${label} ${point ? valueText(point, metric) : '无数据'}${point && point[metric] >= 0 ? unit : ''}，左右方向键查看时间格`}
        />
      </Tooltip>
      <TimelineMarks
        selected={active ? index : undefined}
        colors={displayed
          .map(({ start, point }) => `${start}:${tone(point?.[metric], metric)}`)
          .join(',')}
      />
    </div>
  );
}
