import { ArrowDown, ArrowUp, Clock3, Monitor } from 'lucide-react';
import { Link } from 'react-router';
import type { ProbeLine, StatusNode } from '@/api/public-status';
import { Button } from '@/components/arc/button/button';
import { LineChart } from '@/components/arc/line-chart/line-chart';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/arc/popover/popover';
import {
  bytes,
  cardClass,
  fixed,
  flag,
  percent,
  periodUsage,
  renew,
  speed,
  stamp,
} from '../format';

function Reading({
  name,
  reading,
  detail,
  ratio,
}: {
  name: string;
  reading: string;
  detail: string;
  ratio: number | null;
}) {
  return (
    <div className="min-w-0">
      <div className="flex justify-between gap-1">
        <span className="text-text-secondary">{name}</span>
        <strong className="font-medium">{reading}</strong>
      </div>
      <div className="my-1 break-words text-(length:--text-xs) text-text-secondary">{detail}</div>
      <div className="h-1 overflow-hidden rounded-full bg-surface-raised">
        {ratio !== null && (
          <div
            className="h-full bg-accent"
            style={{ width: `${Math.min(100, Math.max(0, ratio))}%` }}
          />
        )}
      </div>
    </div>
  );
}
export function Quality({ line, now }: { line: ProbeLine; now: number }) {
  const sample = line.latest;
  const end = Math.floor(now / 300000) * 300000;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-1 text-(length:--text-xs)">
      <span className="break-words font-medium">{line.name}</span>
      <span className="text-right">{sample ? stamp(sample.at) : '尚无观测'}</span>
      {(['ping', 'loss'] as const).map((key) => (
        <div key={key}>
          <span>
            {key === 'ping' ? '延迟' : '连接失败率'}{' '}
            {sample && (key === 'loss' || sample.ping >= 0)
              ? `${sample[key]}${key === 'ping' ? ' ms' : '%'}`
              : '—'}
          </span>
          <div className="mt-1 flex gap-px" aria-hidden="true">
            {Array.from({ length: 12 }, (_, i) => {
              const t = end - (11 - i) * 300000;
              const p = line.history.find(
                (p) => Math.floor(Date.parse(p.at) / 300000) * 300000 === t,
              );
              return (
                <span
                  key={t}
                  className={`h-2 flex-1 rounded-xs ${!p ? 'bg-surface-raised' : (key === 'ping' ? p.ping < 0 || p.ping >= 300 : p.loss >= 10) ? 'bg-danger' : (key === 'ping' ? p.ping >= 120 : p.loss > 0) ? 'bg-warning' : 'bg-success'}`}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
export default function NodeCard({
  node: n,
  now,
  link = true,
}: {
  node: StatusNode;
  now: number;
  link?: boolean;
}) {
  const f = n.fast,
    d = n.full;
  const ram =
    f?.ram_used != null && Number(f.ram_total) > 0
      ? (Number(f.ram_used) / Number(f.ram_total)) * 100
      : null;
  const disk =
    d?.disk_used != null &&
    d.disk_available != null &&
    Number(d.disk_used) + Number(d.disk_available) > 0
      ? (100 * Number(d.disk_used)) / (Number(d.disk_used) + Number(d.disk_available))
      : null;
  const usage = periodUsage(f, now),
    quota = f?.quota == null ? null : BigInt(f.quota);
  const level = f?.cpu ?? null;
  const age =
    n.uptime == null
      ? '未知'
      : n.uptime >= 86400
        ? `${Math.floor(n.uptime / 86400)} 天`
        : `${Math.floor(n.uptime / 3600)} 小时`;
  const stale = f && Date.parse(f.expires_at) <= now;
  return (
    <article className={`${cardClass} flex flex-col gap-4 text-(length:--text-sm) tabular-nums`}>
      <header>
        <div className="flex items-start justify-between gap-2">
          <h2 className="min-w-0 wrap-anywhere text-(length:--text-base) font-medium">
            {flag(n.country)}{' '}
            {link ? (
              <Link
                className="underline-offset-4 hover:underline"
                to={`/status/${encodeURIComponent(n.id)}`}
              >
                {n.alias}
              </Link>
            ) : (
              n.alias
            )}
          </h2>
          <span className={`shrink-0 ${n.online ? 'text-success' : 'text-text-secondary'}`}>
            {n.online ? '在线' : '离线'}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-(length:--text-xs) text-text-secondary">
          <Monitor size={14} aria-hidden />
          {n.os || '系统未知'} {n.group && <span>{n.group}</span>}
          <span title={n.ip_at ? stamp(n.ip_at) : undefined}>
            {[n.ipv4 ? 'V4' : '', n.ipv6 ? 'V6' : ''].filter(Boolean).join(' / ') || '地址族未知'}
          </span>
        </div>
      </header>
      <div className="grid grid-cols-2 gap-4">
        <Reading
          name="CPU"
          reading={percent(level)}
          detail={n.cpu_cores ? `${n.cpu_cores} 核` : '核数未登记'}
          ratio={level}
        />
        <Reading
          name="内存"
          reading={percent(ram)}
          detail={`${bytes(f?.ram_used)} / ${bytes(f?.ram_total)}`}
          ratio={ram}
        />
        <Reading
          name="磁盘"
          reading={percent(disk)}
          detail={`${bytes(d?.disk_used)} / ${bytes(d?.disk_total)}`}
          ratio={disk}
        />
        <Reading
          name="负载"
          reading={fixed(d?.load1)}
          detail={`${fixed(d?.load1)} / ${fixed(d?.load5)} / ${fixed(d?.load15)}`}
          ratio={n.cpu_cores && d?.load1 != null ? (100 * d.load1) / n.cpu_cores : null}
        />
      </div>
      <div className="text-(length:--text-xs) text-text-secondary">
        {f ? `${stale ? '上次采样' : '快速采样'} ${stamp(f.sampled_at)}` : '等待资源采样'}
        {d && (
          <div>
            {d.stale ? '上次磁盘与负载采样' : '磁盘与负载采样'} {stamp(d.sampled_at)}
          </div>
        )}
      </div>
      <div className="border-t border-border pt-3">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <ArrowUp size={14} className="inline" aria-hidden /> 上行{' '}
            <b className="font-medium">{speed(f?.tx)}</b>
          </div>
          <div>
            <ArrowDown size={14} className="inline" aria-hidden /> 下行{' '}
            <b className="font-medium">{speed(f?.rx)}</b>
          </div>
        </div>
        {n.speeds.length > 0 && (
          <LineChart
            label="近期带宽"
            height={72}
            legend={false}
            data={n.speeds.map((p) => ({
              key: p.at,
              label: stamp(p.at),
              values: { rx: p.rx, tx: p.tx },
            }))}
            series={[
              { key: 'tx', label: '上行', area: false },
              { key: 'rx', label: '下行', area: false },
            ]}
            formatValue={speed}
          />
        )}
        <div className="mt-2 flex flex-wrap justify-between gap-2 text-(length:--text-xs)">
          出站 {bytes(n.lifetime?.tx)} <span>入站 {bytes(n.lifetime?.rx)}</span>
        </div>
        {n.lifetime && (
          <div className="mt-1 text-(length:--text-xs) text-text-secondary">
            自 {new Date(n.lifetime.start).toLocaleDateString()} 起
            {n.lifetime.partial ? '，记录不完整' : ''}
          </div>
        )}
      </div>
      <Reading
        name="剩余流量"
        reading={
          quota === 0n
            ? '未设额度'
            : quota != null && usage != null
              ? bytes(quota > usage ? quota - usage : 0n)
              : '—'
        }
        detail={`本期 ${bytes(usage)} / ${quota === 0n ? '未设额度' : bytes(quota)}`}
        ratio={usage != null && quota ? (100 * Number(usage)) / Number(quota) : null}
      />
      <div className="grid gap-3 border-y border-border py-3">
        {n.lines.length ? (
          n.lines.map((line) => <Quality key={line.slot} line={line} now={now} />)
        ) : (
          <span className="text-text-secondary">尚未配置探测线路</span>
        )}
      </div>
      <footer className="mt-auto space-y-2 text-(length:--text-xs)">
        <div className="flex flex-wrap justify-between gap-2">
          <span title={n.uptime_at ? stamp(n.uptime_at) : undefined}>
            <Clock3 size={14} className="inline" aria-hidden /> 运行 {age}
          </span>
          <span title={n.expires ? stamp(n.expires) : undefined}>到期 {renew(n.expires, now)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost">采样与账期</Button>
            </PopoverTrigger>
            <PopoverContent>
              <dl className="space-y-2 text-sm">
                {[
                  ['快速采样', f?.sampled_at],
                  ['磁盘与负载', d?.sampled_at],
                  ['地址族观测', n.ip_at],
                  ['运行时长采样', n.uptime_at],
                  ['流量账期结束', f?.period_end],
                  ['租用到期', n.expires],
                ].map(([label, date]) => (
                  <div key={label}>
                    <dt className="text-text-secondary">{label}</dt>
                    <dd>{date ? stamp(date) : '未记录'}</dd>
                  </div>
                ))}
              </dl>
            </PopoverContent>
          </Popover>
          {n.tags.map((label) => (
            <span key={label} className="rounded-(--radius-control) bg-surface-raised px-2 py-1">
              {label}
            </span>
          ))}
          <span>
            {n.price == null
              ? '价格未登记'
              : Number(n.price) === 0
                ? '免费'
                : `${n.price} ${n.currency} / ${n.months === 1 ? '月' : `${n.months} 个月`}`}
          </span>
        </div>
      </footer>
    </article>
  );
}
