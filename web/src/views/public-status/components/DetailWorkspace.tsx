import { ArrowDown, ArrowUp, CircleAlert, Hash, Repeat } from 'lucide-react';
import { useState } from 'react';
import type { StatusNode, StatusPage } from '@/api/public-status';
import { decimalBytes } from '@/api/telemetry';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/arc/popover/popover';
import { UsageMeter } from '@/components/arc/usage-meter/usage-meter';
import {
  bytes,
  exactBytes,
  monthlyCNY,
  periodUsage,
  renew,
  rentalPeriodProgress,
  rentalValue,
  stamp,
  statusFullFresh,
  statusRelativeTime,
  statusUptime,
} from '../format';

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
  now,
}: {
  node: StatusNode;
  rates: StatusPage['rates'];
  now: number;
}) {
  const [exact, setExact] = useState(false);
  const [currencyMode, setCurrencyMode] = useState<'native' | 'cny'>('native');

  const fast = node.fast;
  const freshFull = statusFullFresh(node, now) ? node.full : null;
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

  const periodTotalNative = node.price != null ? Number(node.price) : null;
  const periodTotalCNY =
    monthlyEstimate !== null && node.months ? monthlyEstimate * node.months : null;

  return (
    <section
      className="grid min-w-0 items-stretch gap-4 xl:grid-cols-12"
      aria-label="流量账期与节点资产"
    >
      <article className="v-card flex min-w-0 flex-col justify-between gap-5 xl:col-span-7">
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

        <div className="grid gap-4 border-t-[1px] border-border pt-4 text-(length:--text-xs) tabular-nums sm:grid-cols-3">
          <div className="min-w-0 space-y-1.5">
            <span className="block text-text-secondary">今日流量</span>
            {daily ? (
              <div className="space-y-1 font-medium text-foreground">
                <div className="flex items-center gap-1.5 wrap-anywhere">
                  <ArrowDown size={12} className="shrink-0 text-success" aria-hidden="true" />
                  <span>{formatVolume(daily.rx_bytes)}</span>
                </div>
                <div className="flex items-center gap-1.5 wrap-anywhere">
                  <ArrowUp size={12} className="shrink-0 text-(--info)" aria-hidden="true" />
                  <span>{formatVolume(daily.tx_bytes)}</span>
                </div>
              </div>
            ) : (
              <p className="font-medium text-text-secondary">暂无今日采样</p>
            )}
          </div>

          <div className="min-w-0 space-y-1.5 border-t-[1px] border-border-subtle pt-3 sm:border-t-0 sm:border-l-[1px] sm:pt-0 sm:pl-4">
            <span className="block text-text-secondary">账期时间窗</span>
            <p className="font-medium text-foreground wrap-anywhere">
              {fast?.period_start && fast?.period_end
                ? `${new Date(fast.period_start).toLocaleDateString('zh-CN')} 至 ${new Date(fast.period_end).toLocaleDateString('zh-CN')}`
                : '未知'}
            </p>
            {fast?.period_end && (
              <span className="block text-text-muted">重置 {stamp(fast.period_end)}</span>
            )}
          </div>

          <div className="min-w-0 space-y-1.5 border-t-[1px] border-border-subtle pt-3 sm:border-t-0 sm:border-l-[1px] sm:pt-0 sm:pl-4">
            <span className="block text-text-secondary">
              账本累计
              {node.lifetime
                ? `（自 ${new Date(node.lifetime.start).toLocaleDateString('zh-CN')}）`
                : ''}
            </span>
            {node.lifetime ? (
              <div className="space-y-1 font-medium text-foreground">
                <div className="flex items-center gap-1.5 wrap-anywhere">
                  <ArrowDown size={12} className="shrink-0 text-success" aria-hidden="true" />
                  <span>
                    {formatVolume(node.lifetime.rx)}
                    {node.lifetime.partial ? ' *' : ''}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 wrap-anywhere">
                  <ArrowUp size={12} className="shrink-0 text-(--info)" aria-hidden="true" />
                  <span>{formatVolume(node.lifetime.tx)}</span>
                </div>
              </div>
            ) : (
              <p className="font-medium text-text-secondary">暂无累计记录</p>
            )}
          </div>
        </div>
      </article>

      <article className="v-card flex min-w-0 flex-col justify-between gap-4 xl:col-span-5">
        <div className="space-y-3.5 tabular-nums">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b-[1px] border-border pb-3">
            <h2 className="v-card-title">租用与费用</h2>
            <div className="flex flex-wrap items-center gap-2">
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
          </div>

          <div className="flex flex-wrap items-baseline justify-between gap-3">
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
            {monthlyEstimate !== null && (
              <div className="text-right">
                <span className="block text-(length:--text-xs) text-text-secondary">
                  折合月付参考
                </span>
                <span className="text-(length:--text-sm) font-medium text-foreground">
                  {showCNY || node.currency === 'CNY'
                    ? `${formatCurrency(monthlyEstimate, 'CNY')} / 月`
                    : `${formatCurrency((periodTotalNative ?? 0) / (node.months ?? 1), node.currency)} / 月`}
                </span>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
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

          <p className="text-(length:--text-xs) text-text-secondary">
            {remainingCNY !== null
              ? `剩余租期估值 ${formatCurrency(remainingCNY, 'CNY')}${fxDate ? `（汇率 ${fxDate}）` : ''}`
              : node.price == null && !node.expires
                ? '未登记周期资费与到期时间，当前不计入公开资产估值。'
                : '当前缺少完整估值参数，未折算剩余租期金额。'}
          </p>
        </div>

        <div className="space-y-2.5 border-t-[1px] border-border pt-4">
          <h3 className="text-(length:--text-xs) font-medium text-text-secondary">运行环境</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-(length:--text-xs) tabular-nums">
            <div className="min-w-0 space-y-0.5">
              <dt className="text-text-secondary">主机运行时长</dt>
              <dd className="font-medium text-foreground wrap-anywhere">
                {statusUptime(node, now)}
              </dd>
            </div>
            <div className="min-w-0 space-y-0.5">
              <dt className="text-text-secondary">活跃进程数</dt>
              <dd className="font-medium text-foreground wrap-anywhere">
                {freshFull?.processes ?? '未知'}
              </dd>
            </div>
            <div className="min-w-0 space-y-0.5">
              <dt className="text-text-secondary">最后在线时间</dt>
              <dd
                className="font-medium text-foreground wrap-anywhere"
                title={node.last_seen_at ? stamp(node.last_seen_at) : undefined}
              >
                {statusRelativeTime(node.last_seen_at, now)}
              </dd>
            </div>
            <div className="min-w-0 space-y-0.5">
              <dt className="text-text-secondary">地址族观测</dt>
              <dd
                className="font-medium text-foreground wrap-anywhere"
                title={node.ip_at ? stamp(node.ip_at) : undefined}
              >
                {statusRelativeTime(node.ip_at, now)}
              </dd>
            </div>
          </dl>
        </div>
      </article>
    </section>
  );
}
