import { ArrowDown, ArrowUp, CircleAlert, Clock, Hash, Repeat } from 'lucide-react';
import { useState } from 'react';
import type {
  StatusHistory,
  StatusHistoryRange,
  StatusNode,
  StatusPage,
} from '@/api/public-status';
import { decimalBytes } from '@/api/telemetry';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/arc/popover/popover';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { UsageMeter } from '@/components/arc/usage-meter/usage-meter';
import { CountryFlag } from '@/components/country-flag';
import EmptyStates from '@/components/empty-states';
import { NodeOSLabel } from '@/components/node-os-icon';
import { TCPProbeRow } from '@/components/tcp-probe-row';
import { ProbeLineChart } from '@/views/nodes/components/TCPProbeQuality';
import {
  bytes,
  exactBytes,
  monthlyCNY,
  periodUsage,
  renew,
  rentalPeriodProgress,
  rentalValue,
  stamp,
  statusFastFresh,
  statusNodeKind,
  statusRangeLabels,
  statusRegion,
  statusRelativeTime,
  statusUptime,
} from '../format';
import { statusProbePeriod, statusProbeSlots } from '../probe-slots';
import { statusProbeHistoryBlocks, statusProbeHistorySlots } from '../status-charts';

const billingLabels: Record<string, string> = {
  both: '双向计费（RX + TX）',
  outbound: '仅上行计费（TX）',
  inbound: '仅下行计费（RX）',
};

const trafficQualityLabels: Record<string, string> = {
  baseline: '刚建立基线',
  partial: '采样不完整',
  counter_reset: '计数器已重置',
  identity_changed: '网卡身份变化',
  period_gap: '存在采集间隔',
  boundary_estimated: '周期边界存在未计入流量',
  mixed_filter: '网卡过滤规则已变化',
  persist_failed: '本地保存失败',
  unknown: '未知',
};

function formatCurrency(amount: number, currency: string) {
  return amount.toLocaleString('zh-CN', { style: 'currency', currency });
}

export default function DetailWorkspace({
  node,
  rates,
  snapshotAt,
  now,
  range,
  history,
}: {
  node: StatusNode;
  rates: StatusPage['rates'];
  snapshotAt: string;
  now: number;
  range: StatusHistoryRange;
  history: StatusHistory | null;
}) {
  const [exact, setExact] = useState(false);
  const [currencyMode, setCurrencyMode] = useState<'native' | 'cny'>('native');
  const [probeView, setProbeView] = useState<'blocks' | 'line'>('blocks');
  const [probeMetric, setProbeMetric] = useState<'ping' | 'loss'>('ping');

  const fast = node.fast;
  const freshFast = statusFastFresh(node, now) ? fast : null;
  const quota = fast?.quota != null ? BigInt(fast.quota) : undefined;
  const used = periodUsage(fast, now);
  const meterUnit = decimalBytes(
    ((quota && quota > 0n ? quota : (used ?? 0n)) || 0n).toString(),
  ).split(' ')[1];
  const meterDivisor = 1000 ** ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'].indexOf(meterUnit);
  const meterSegments = [
    ...(fast?.billing_mode !== 'outbound' && fast?.period_rx != null
      ? [{ id: 'rx', label: '下行（RX）', value: Number(fast.period_rx) / meterDivisor }]
      : []),
    ...(fast?.billing_mode !== 'inbound' && fast?.period_tx != null
      ? [{ id: 'tx', label: '上行（TX）', value: Number(fast.period_tx) / meterDivisor }]
      : []),
  ];

  const qualityText = fast?.traffic_quality?.length
    ? fast.traffic_quality.map((q) => trafficQualityLabels[q] ?? q).join('，')
    : '';
  const daily =
    node.daily && now >= Date.parse(node.daily.day_start) && now < Date.parse(node.daily.day_end)
      ? node.daily
      : null;
  const dailyQualityText = daily
    ? [
        daily.quality & 2 ? '跨日按时间估算' : '',
        daily.quality & 4 ? '统计口径变化' : '',
        daily.quality & 8 ? '存在历史缺口' : '',
      ]
        .filter(Boolean)
        .join('，')
    : '';
  const hasCaveats = Boolean(qualityText || dailyQualityText || node.lifetime?.partial);

  const formatVolume = (value: string | number | bigint | null | undefined) =>
    exact
      ? exactBytes(value)
      : typeof value === 'string' && /^\d+$/.test(value)
        ? decimalBytes(value)
        : bytes(value);

  const remainingDays =
    node.expires && now > 0 ? Math.ceil((Date.parse(node.expires) - now) / 86400000) : null;
  const remainingCNY = rentalValue(node, rates, now);
  const monthlyEstimate = monthlyCNY(node, rates);
  const periodProgress = rentalPeriodProgress(node.expires, node.months, now);
  const canToggleCNY =
    node.currency !== 'CNY' &&
    node.price != null &&
    Number(node.price) > 0 &&
    monthlyEstimate !== null;
  const showCNY = canToggleCNY && currencyMode === 'cny';
  const fxDate =
    node.currency !== 'CNY'
      ? (rates.quotes?.[node.currency]?.date ?? rates.quotes?.CNY?.date ?? rates.day)
      : '';

  const activeLines = history?.lines ?? node.lines;
  const probePeriod = history?.probe_period ?? statusProbePeriod;
  const latestSampleAt = freshFast?.sampled_at ?? node.fast?.sampled_at ?? node.full?.sampled_at;

  const profileCells = [
    {
      label: '所在地区',
      value: (
        <span className="inline-flex items-center gap-1.5">
          <CountryFlag code={node.country} />
          <span>{statusRegion(node)}</span>
        </span>
      ),
    },
    { label: '节点类型', value: statusNodeKind(node.kind) },
    {
      label: '公网地址族',
      value:
        node.ipv4 || node.ipv6 ? (
          <div className="inline-flex flex-wrap items-center gap-1.5">
            {node.ipv4 && (
              <Badge tone="success" outline size="sm">
                IPv4
              </Badge>
            )}
            {node.ipv6 && (
              <Badge tone="success" outline size="sm">
                IPv6
              </Badge>
            )}
          </div>
        ) : (
          '未知'
        ),
    },
    { label: '操作系统', value: <NodeOSLabel os={node.os} /> },
    { label: 'CPU 核数', value: node.cpu_cores ? `${node.cpu_cores} 核` : '未登记' },
    { label: 'CPU 架构', value: node.arch || '未上报' },
    { label: '运行时长', value: statusUptime(node, now) },
    { label: '最后在线', value: node.last_seen_at ? stamp(node.last_seen_at) : '未记录' },
  ];

  const periodTotalNative = node.price != null ? Number(node.price) : null;
  const periodTotalCNY =
    monthlyEstimate !== null && node.months ? monthlyEstimate * node.months : null;

  return (
    <div className="min-w-0 space-y-4">
      <div className="grid min-w-0 items-stretch gap-4 md:grid-cols-2 xl:grid-cols-12">
        <section
          className="v-card flex min-w-0 flex-col justify-between gap-4 md:col-span-2 xl:col-span-5"
          aria-label="流量与账期"
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="v-card-title">流量与账期</h2>
                <Badge tone="neutral">
                  {fast?.billing_mode
                    ? (billingLabels[fast.billing_mode] ?? '计费设置未知')
                    : '计费设置未知'}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {hasCaveats && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="查看流量统计口径说明"
                        className="text-warning"
                      >
                        <CircleAlert size={14} aria-hidden="true" />
                        <span>口径说明</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" aria-label="流量统计口径说明">
                      <div className="space-y-2 text-(length:--text-xs) text-text-secondary">
                        {qualityText && <p>本期统计：{qualityText}</p>}
                        {dailyQualityText && <p>今日流量：{dailyQualityText}</p>}
                        {node.lifetime?.partial && (
                          <p>累计账本：包含重注册、历史缺口或尚未结束的当日采样</p>
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-pressed={exact}
                  onClick={() => setExact((v) => !v)}
                >
                  <Hash size={14} aria-hidden="true" />
                  <span>{exact ? '易读单位' : '完整字节'}</span>
                </Button>
              </div>
            </div>

            {used !== null && quota !== undefined ? (
              <UsageMeter
                label="本期计费用量"
                segments={meterSegments}
                limit={quota > 0n ? Number(quota) / meterDivisor : undefined}
                unit={meterUnit}
                decimals={2}
                freeLabel="剩余额度"
                overLabel="超出额度"
              />
            ) : (
              <div className="space-y-1.5 tabular-nums">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-(length:--text-sm) text-text-secondary">本期计费用量</span>
                  <strong className="text-(length:--text-xl) font-medium">未知</strong>
                  <span className="text-(length:--text-xs) text-text-secondary">
                    {quota === undefined
                      ? '额度未知'
                      : quota === 0n
                        ? '无限额度'
                        : `额度 ${decimalBytes(quota.toString())}`}
                  </span>
                </div>
                <p className="text-(length:--text-xs) text-text-secondary">
                  {qualityText || '等待有效账期流量数据'}
                </p>
              </div>
            )}
          </div>

          <div className="grid gap-3 rounded-(--radius-control) border-[1px] border-border bg-surface-muted p-3.5 text-(length:--text-xs) tabular-nums sm:grid-cols-3">
            <div className="min-w-0 space-y-1">
              <span className="text-text-secondary">今日流量</span>
              {daily ? (
                <div className="space-y-0.5 font-medium text-foreground">
                  <div className="flex items-center gap-1 wrap-anywhere">
                    <ArrowDown size={12} className="shrink-0 text-success" aria-hidden="true" />
                    <span>{formatVolume(daily.rx_bytes)}</span>
                  </div>
                  <div className="flex items-center gap-1 wrap-anywhere">
                    <ArrowUp size={12} className="shrink-0 text-(--info)" aria-hidden="true" />
                    <span>{formatVolume(daily.tx_bytes)}</span>
                  </div>
                </div>
              ) : (
                <p className="font-medium text-text-secondary">暂无今日采样</p>
              )}
            </div>

            <div className="min-w-0 space-y-1">
              <span className="text-text-secondary">账期时间窗</span>
              <p className="font-medium text-foreground wrap-anywhere">
                {fast?.period_start && fast?.period_end
                  ? `${new Date(fast.period_start).toLocaleDateString('zh-CN')} 至 ${new Date(fast.period_end).toLocaleDateString('zh-CN')}`
                  : '未知'}
              </p>
              {fast?.period_end && (
                <span className="block text-text-muted">重置 {stamp(fast.period_end)}</span>
              )}
            </div>

            <div className="min-w-0 space-y-1">
              <span className="text-text-secondary">
                账本累计
                {node.lifetime
                  ? `（自 ${new Date(node.lifetime.start).toLocaleDateString('zh-CN')}）`
                  : ''}
              </span>
              {node.lifetime ? (
                <div className="space-y-0.5 font-medium text-foreground">
                  <div className="flex items-center gap-1 wrap-anywhere">
                    <ArrowDown size={12} className="shrink-0 text-success" aria-hidden="true" />
                    <span>
                      {formatVolume(node.lifetime.rx)}
                      {node.lifetime.partial ? ' *' : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 wrap-anywhere">
                    <ArrowUp size={12} className="shrink-0 text-(--info)" aria-hidden="true" />
                    <span>{formatVolume(node.lifetime.tx)}</span>
                  </div>
                </div>
              ) : (
                <p className="font-medium text-text-secondary">暂无累计记录</p>
              )}
            </div>
          </div>
        </section>

        <section
          className="v-card flex min-w-0 flex-col justify-between gap-4 xl:col-span-4"
          aria-label="公开节点档案"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b-[1px] border-border pb-3">
            <h2 className="v-card-title">节点档案</h2>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" aria-label="查看各项采样时间明细">
                  <Clock size={14} aria-hidden="true" />
                  <span className="tabular-nums">
                    {latestSampleAt
                      ? `采样 ${statusRelativeTime(latestSampleAt, now)}`
                      : '采样时间'}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" aria-label="采样时间明细">
                <dl className="space-y-2 text-(length:--text-xs) tabular-nums">
                  {[
                    ['快速采样', freshFast?.sampled_at ?? node.fast?.sampled_at],
                    ['磁盘与负载', node.full?.sampled_at],
                    ['地址族观测', node.ip_at],
                    ['运行时长采样', node.uptime_at],
                    ['最后在线', node.last_seen_at],
                  ].map(([label, date]) => (
                    <div key={label} className="flex items-center justify-between gap-4">
                      <dt className="text-text-secondary">{label}</dt>
                      <dd>{date ? stamp(date) : '未记录'}</dd>
                    </div>
                  ))}
                </dl>
              </PopoverContent>
            </Popover>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5 text-(length:--text-sm)">
            {profileCells.map((cell) => (
              <div key={cell.label} className="min-w-0 space-y-1">
                <dt className="text-(length:--text-xs) text-text-secondary">{cell.label}</dt>
                <dd className="min-w-0 font-medium text-foreground wrap-anywhere tabular-nums">
                  {cell.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section
          className="v-card flex min-w-0 flex-col justify-between gap-4 xl:col-span-3"
          aria-label="租用与费用"
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b-[1px] border-border pb-3">
              <h2 className="v-card-title">租用与费用</h2>
              {node.expires && remainingDays !== null ? (
                <Badge
                  tone={remainingDays <= 0 ? 'danger' : remainingDays <= 7 ? 'warning' : 'neutral'}
                >
                  {renew(node.expires, now)}
                </Badge>
              ) : (
                <Badge tone="neutral">未设到期</Badge>
              )}
            </div>

            <div className="space-y-3 tabular-nums">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <span className="text-(length:--text-xs) text-text-secondary">周期资费</span>
                  <p className="text-(length:--text-xl) font-medium text-foreground wrap-anywhere">
                    {node.price == null
                      ? '未登记'
                      : Number(node.price) === 0
                        ? '免费'
                        : showCNY && periodTotalCNY !== null
                          ? `${formatCurrency(periodTotalCNY, 'CNY')} / ${node.months === 1 ? '月' : `${node.months} 个月`}`
                          : `${formatCurrency(periodTotalNative ?? 0, node.currency || 'CNY')} / ${node.months === 1 ? '月' : `${node.months} 个月`}`}
                  </p>
                </div>
                {canToggleCNY && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCurrencyMode((m) => (m === 'native' ? 'cny' : 'native'))}
                    aria-label="切换显示币种"
                  >
                    <Repeat size={14} aria-hidden="true" />
                    <span>{showCNY ? node.currency : '人民币'}</span>
                  </Button>
                )}
              </div>

              {monthlyEstimate !== null && (
                <div className="flex flex-wrap items-center justify-between gap-2 text-(length:--text-xs) text-text-secondary">
                  <span>折合月付参考</span>
                  <span className="font-medium text-foreground">
                    {showCNY || node.currency === 'CNY'
                      ? `${formatCurrency(monthlyEstimate, 'CNY')} / 月`
                      : `${formatCurrency((periodTotalNative ?? 0) / (node.months ?? 1), node.currency)} / 月`}
                  </span>
                </div>
              )}

              <div className="space-y-1.5 border-t-[1px] border-border pt-3">
                <div className="flex items-center justify-between gap-2 text-(length:--text-xs)">
                  <span className="text-text-secondary">到期时间</span>
                  <span className="font-medium text-foreground">
                    {node.expires ? new Date(node.expires).toLocaleDateString('zh-CN') : '未登记'}
                  </span>
                </div>
                {periodProgress && (
                  <div className="space-y-1">
                    <div
                      role="progressbar"
                      aria-label="当前租用周期进度"
                      aria-valuenow={Math.round(periodProgress.percent)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      className="h-1.5 w-full overflow-hidden rounded-full bg-(--usage-track)"
                    >
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${periodProgress.percent}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-(length:--text-xs) text-text-muted">
                      <span>{new Date(periodProgress.start).toLocaleDateString('zh-CN')}</span>
                      <span>已过 {Math.round(periodProgress.percent)}%</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <p className="border-t-[1px] border-border pt-3 text-(length:--text-xs) text-text-secondary tabular-nums">
            {remainingCNY !== null
              ? `剩余租期估值 ${formatCurrency(remainingCNY, 'CNY')}${fxDate ? `（汇率 ${fxDate}）` : ''}`
              : node.price == null && !node.expires
                ? '未登记周期资费与到期时间，当前不计入公开资产估值。'
                : '当前缺少完整估值参数，未折算剩余租期金额。'}
          </p>
        </section>
      </div>

      <section className="v-card min-w-0 space-y-4" aria-label="TCP 线路质量">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="v-card-title">TCP 线路质量</h2>
            <span className="text-(length:--text-xs) text-text-secondary">
              {history ? `最近 ${statusRangeLabels[range]}` : '快照最近 1 小时'}
            </span>
            {activeLines.length > 0 && <Badge tone="neutral">{activeLines.length} 条线路</Badge>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {probeView === 'line' && activeLines.length > 0 && (
              <SegmentedControl
                label="折线图指标"
                value={probeMetric}
                onValueChange={(value) => setProbeMetric(value as 'ping' | 'loss')}
                options={[
                  { value: 'ping', label: '连接延迟' },
                  { value: 'loss', label: '连接失败率' },
                ]}
              />
            )}
            <SegmentedControl
              label="TCP 线路质量显示方式"
              value={probeView}
              onValueChange={(value) => setProbeView(value as 'blocks' | 'line')}
              options={[
                { value: 'blocks', label: '色块' },
                { value: 'line', label: '折线图' },
              ]}
            />
          </div>
        </div>

        {!activeLines.length ? (
          <EmptyStates
            compact
            headingLevel={3}
            variant="empty"
            title="尚未配置探测线路"
            description="管理员未对该节点启用公开 TCP 线路观测。"
          />
        ) : probeView === 'line' ? (
          <ProbeLineChart
            metric={probeMetric}
            rows={activeLines.map((line) => ({
              key: String(line.slot),
              name: line.name,
              slots: history
                ? statusProbeHistorySlots(line, history.start, history.end, history.probe_period)
                : statusProbeSlots(line, Date.parse(snapshotAt)).map((s) => ({
                    start: s.start,
                    point: s.point,
                  })),
            }))}
            period={probePeriod}
            loaded
            loading={false}
          />
        ) : (
          <ul className="space-y-4">
            {activeLines.map((line) => {
              if (history) {
                const { width, blocks, summary } = statusProbeHistoryBlocks(
                  line,
                  history.start,
                  history.end,
                  history.probe_period,
                );
                return (
                  <TCPProbeRow
                    key={line.slot}
                    name={line.name}
                    probe={summary}
                    slots={blocks}
                    period={width}
                    loaded
                  />
                );
              }
              return (
                <TCPProbeRow
                  key={line.slot}
                  name={line.name}
                  probe={line.latest ?? undefined}
                  slots={statusProbeSlots(line, Date.parse(snapshotAt))}
                  period={statusProbePeriod}
                  loaded
                />
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
