import { memo, useMemo, useState } from 'react';
import { nodeTime } from '@/api/nodes';
import {
  type TCPRange,
  tcpHistoryBlocks,
  tcpHistorySlots,
  tcpHistorySummary,
  tcpRanges,
} from '@/api/tcp-probe-history';
import type { TCPProbe, TelemetrySnapshot } from '@/api/telemetry';
import { Button } from '@/components/arc/button/button';
import { LineChart } from '@/components/arc/line-chart/line-chart';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { Tooltip } from '@/components/arc/tooltip/tooltip';
import { useTCPProbeHistory } from './use-tcp-probe-history';

type Metric = 'ping' | 'loss';
const timeFormat = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const dateTimeFormat = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const metrics = [
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
  return value >= 33 ? 'poor' : value > 0 ? 'fair' : 'good';
}
function valueText(probe: TCPProbe, metric: Metric) {
  const value = probe[metric];
  if (metric === 'ping' && value === -1) return '无成功样本';
  return metric === 'loss' ? String(Number(value.toFixed(1))) : value.toFixed(1);
}

export default function TCPProbeQuality({
  id,
  active,
  telemetry,
  now,
  compact = false,
  onDetails,
}: {
  id: string;
  active: boolean;
  telemetry?: TelemetrySnapshot;
  now: number;
  compact?: boolean;
  onDetails?: () => void;
}) {
  const Heading = compact ? 'h2' : 'h3';
  const [view, setView] = useState<'blocks' | 'line'>('blocks');
  const probes = telemetry?.full?.tcp_probes;
  const { range, setRange, result, live, loading, refresh } = useTCPProbeHistory(
    id,
    active,
    probes,
  );
  const displayedRange = compact ? '1h' : (result?.range ?? range);
  const period = tcpRanges[displayedRange].period;
  const end = now || (result ? Date.parse(result.data.end) : 0);
  const start = end - tcpRanges[displayedRange].seconds * 1000;
  const points = useMemo(() => [...(result?.data.points ?? []), ...live], [result, live]);
  const blockHistory =
    compact && result
      ? {
          ...result.data,
          start: new Date(start).toISOString(),
          end: new Date(end).toISOString(),
          points: result.data.points.filter(
            (point) => Date.parse(point.sampled_at) >= start && Date.parse(point.sampled_at) < end,
          ),
        }
      : result?.data;
  const config = telemetry?.settings?.tcp_probe;
  const targets = [
    ...new Set([
      ...(config?.targets ?? []),
      ...(probes?.targets ?? []).map((p) => p.target),
      ...(result?.data.points ?? []).flatMap((p) => p.targets.map((probe) => probe.target)),
    ]),
  ];

  return (
    <section className="v-card min-w-0 space-y-4" aria-label="TCP 线路质量">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Heading className="v-card-title">TCP 线路质量</Heading>
        <div className="flex items-center gap-2">
          <span className="text-(length:--text-xs) text-text-secondary">
            {compact ? '' : '最近 '}
            {tcpRanges[displayedRange].label}
          </span>
        </div>
      </div>
      {!compact && (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <SegmentedControl
            label="TCP 历史时间范围"
            className="max-w-full"
            value={range}
            onValueChange={(value) => setRange(value as TCPRange)}
            options={Object.entries(tcpRanges).map(([value, item]) => ({
              value,
              label: item.label,
            }))}
          />
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <SegmentedControl
              label="TCP 线路质量显示方式"
              value={view}
              onValueChange={(value) => setView(value as 'blocks' | 'line')}
              options={[
                { value: 'blocks', label: '色块' },
                { value: 'line', label: '折线图' },
              ]}
            />
            <Button variant="ghost" disabled={loading} onClick={refresh}>
              {loading ? '正在读取' : '刷新历史'}
            </Button>
          </div>
        </div>
      )}

      {!targets.length ? (
        <p className="min-h-24 text-(length:--text-sm) text-text-secondary">
          {result ? '所选时段暂无 TCP 探测数据' : '等待读取 TCP 历史'}
        </p>
      ) : !compact && view === 'line' ? (
        <div className="min-w-0 space-y-4">
          <ProbeLineChart
            rows={targets.map((target) => ({
              target,
              name: config?.names?.[config.targets.indexOf(target)] || target,
              slots: end > 0 ? tcpHistorySlots(points, target, start, end, period) : [],
            }))}
            period={period}
            loaded={!!result}
            loading={loading}
          />
        </div>
      ) : (
        <ul className="space-y-4">
          {targets.map((target) => {
            const name = config?.names?.[config.targets.indexOf(target)] || target;
            const probe = tcpHistorySummary(blockHistory, target);
            return (
              <li key={target} className="grid min-w-0 grid-cols-2 gap-x-4 sm:gap-x-10">
                {metrics.map(({ key, label, unit }) => {
                  const color = tone(probe?.[key], key);
                  return (
                    <div key={key} className="min-w-0">
                      <div className="flex min-h-7 flex-wrap items-baseline justify-between gap-x-2">
                        {key === 'ping' ? (
                          <span className="min-w-0 text-(length:--text-sm) font-medium wrap-anywhere">
                            {name}
                          </span>
                        ) : (
                          <span className="sr-only">{label}</span>
                        )}
                        <span
                          className="ml-auto shrink-0 text-(length:--text-lg) font-medium tabular-nums"
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
                        slots={tcpHistoryBlocks(blockHistory, target, displayedRange, end)}
                        name={name}
                        metric={key}
                        label={label}
                        unit={unit}
                        period={period}
                        loaded={!!result}
                      />
                    </div>
                  );
                })}
              </li>
            );
          })}
        </ul>
      )}
    </section>
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
      className="pointer-events-none absolute inset-x-0 top-1/2 flex h-4 -translate-y-1/2 gap-1"
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
  slots: ReturnType<typeof tcpHistoryBlocks>;
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
          className="w-full min-w-0 bg-transparent!"
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

type ProbeChartRow = {
  target: string;
  name: string;
  slots: ReturnType<typeof tcpHistorySlots>;
};

const ProbeLineChart = memo(
  function ProbeLineChart({
    rows,
    period,
    loaded,
    loading,
  }: {
    rows: ProbeChartRow[];
    period: number;
    loaded: boolean;
    loading: boolean;
  }) {
    const format = period >= 3600 ? dateTimeFormat : timeFormat;
    const { label, unit } = metrics[0];
    return (
      <LineChart
        label={`TCP ${label}`}
        categoryLabel="时间段"
        height={240}
        curve="linear"
        legend
        loading={loading}
        emptyLabel={loaded ? '暂无有效采样' : '历史尚未读取'}
        data={(rows[0]?.slots ?? []).map(({ start }, index) => ({
          key: String(start),
          label: `${format.format(start * 1000)} - ${format.format((start + period) * 1000)}`,
          axisLabel: format.format(start * 1000),
          valueLabels: Object.fromEntries(
            rows.map(({ target, slots }) => {
              const point = slots[index].point;
              return [
                target,
                point
                  ? `${valueText(point, 'ping')}${point.ping >= 0 ? ' ms' : ''}\n丢包率 ${point.loss}%`
                  : '无采样',
              ];
            }),
          ),
          values: Object.fromEntries(
            rows.map(({ target, slots }) => {
              const point = slots[index].point;
              return [target, point && point.ping >= 0 ? point.ping : null];
            }),
          ),
        }))}
        series={rows.map(({ target, name }, index) => ({
          key: target,
          label: name,
          color: `var(--series-${(index % 4) + 1})`,
          area: false,
        }))}
        formatValue={(value) => `${Number(value.toFixed(1))} ${unit}`}
        formatTick={(value) => `${Number(value.toFixed(1))} ${unit}`}
      />
    );
  },
  (previous, next) =>
    previous.period === next.period &&
    previous.loaded === next.loaded &&
    previous.loading === next.loading &&
    previous.rows.length === next.rows.length &&
    previous.rows.every((row, index) => {
      const other = next.rows[index];
      return (
        row.target === other.target &&
        row.name === other.name &&
        row.slots.length === other.slots.length &&
        row.slots.every(
          (slot, slotIndex) =>
            slot.start === other.slots[slotIndex].start &&
            slot.point?.ping === other.slots[slotIndex].point?.ping &&
            slot.point?.loss === other.slots[slotIndex].point?.loss,
        )
      );
    }),
);
