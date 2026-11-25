import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  CircleDollarSign,
  Cpu,
  Database,
  Gauge,
  Globe,
  HardDrive,
  type LucideIcon,
  MemoryStick,
  RefreshCw,
} from 'lucide-react';
import { Link } from 'react-router';
import type { ProbeLine, StatusNode } from '@/api/public-status';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/arc/popover/popover';
import { CountryFlag } from '@/components/country-flag';
import { NodeOSIcon } from '@/components/node-os-icon';
import { TCPProbeRow } from '@/components/tcp-probe-row';
import { bytes, fixed, percent, periodUsage, renew, speed, stamp } from '../format';
import { statusProbePeriod, statusProbeSlots } from '../probe-slots';

function Segments({
  ratio,
  color,
  count = 18,
}: {
  ratio: number | null;
  color: string;
  count?: number;
}) {
  const active = Math.ceil((Math.min(100, Math.max(0, ratio ?? 0)) * count) / 100);
  return (
    <div aria-hidden className="flex h-2 gap-0.5">
      {Array.from({ length: count }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: Each mark represents a fixed position on the scale.
          key={i}
          className="min-w-0 flex-1 rounded-xs bg-border"
          style={i < active ? { backgroundColor: color } : undefined}
        />
      ))}
    </div>
  );
}
function Traffic({
  node,
  direction,
  now,
}: {
  node: StatusNode;
  direction: 'rx' | 'tx';
  now: number;
}) {
  const up = direction === 'tx',
    Icon = up ? ArrowUp : ArrowDown;
  const fresh = node.online && node.fast && Date.parse(node.fast.expires_at) > now;
  const rate = fresh ? node.fast?.[direction] : null;
  const [value, unit] = speed(rate).split(' ');
  const samples = node.speeds.slice(-20);
  const peak = Math.max(1, ...samples.map((p) => p[direction] ?? 0));
  return (
    <div className="row-span-3 grid min-w-0 grid-cols-1 grid-rows-subgrid gap-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-1">
        <span className="inline-flex shrink-0 items-center gap-1.5 text-text-secondary">
          <Icon size={14} aria-hidden />
          {up ? '上行' : '下行'}
        </span>
        <strong
          className={`ml-auto whitespace-nowrap text-xl font-semibold leading-none ${rate == null ? 'text-text-secondary' : rate >= 1e6 ? 'text-warning' : 'text-success'}`}
        >
          {value}
          <small className="ml-0.5 text-xs font-normal text-text-secondary">{unit}</small>
        </strong>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex h-2.5 min-w-0 flex-1 items-center justify-between gap-0.5" aria-hidden>
          {samples.map((p) => {
            const v = p[direction];
            return (
              <span
                key={p.at}
                className={`size-1 min-w-0 rounded-full ${v ? 'bg-success' : 'bg-border'}`}
                style={{ transform: `scale(${v ? 0.7 + v / peak : 0.5})` }}
              />
            );
          })}
        </div>
        <span className="shrink-0 text-text-secondary">{rate == null ? '无读数' : '实时'}</span>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-1 text-text-secondary">
        <span className="inline-flex shrink-0 items-center gap-1">
          <Globe size={14} aria-hidden />
          {up ? '出站' : '入站'}
        </span>
        <span
          className="ml-auto whitespace-nowrap"
          title={
            node.lifetime
              ? `自 ${stamp(node.lifetime.start)} 起${node.lifetime.partial ? '，记录不完整' : ''}`
              : undefined
          }
        >
          {bytes(node.lifetime?.[direction])}
          {node.lifetime?.partial ? '*' : ''}
        </span>
      </div>
    </div>
  );
}
function Reading({
  name,
  icon: Icon,
  color,
  reading,
  detail,
  ratio,
}: {
  name: string;
  icon: LucideIcon;
  color: string;
  reading: string;
  detail: string;
  ratio: number | null;
}) {
  return (
    <div className="min-w-0">
      <div className="flex justify-between gap-1">
        <span className="inline-flex items-center gap-1.5 text-(length:--text-xs) text-text-secondary">
          <Icon size={14} aria-hidden />
          {name}
        </span>
        <strong className="font-medium">{reading}</strong>
      </div>
      <div className="my-1 break-words text-(length:--text-xs) text-text-secondary">{detail}</div>
      <Segments ratio={ratio} color={color} />
    </div>
  );
}
function Quality({ line, now }: { line: ProbeLine; now: number }) {
  const slots = statusProbeSlots(line, now);
  return (
    <TCPProbeRow
      name={line.name}
      probe={line.latest ?? undefined}
      slots={slots}
      period={statusProbePeriod}
      loaded
    />
  );
}
export default function NodeCard({
  node: n,
  now,
  snapshotAt,
  link = true,
}: {
  node: StatusNode;
  now: number;
  snapshotAt: string;
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
  const showDays = n.uptime != null && n.uptime >= 86400;
  const age = n.uptime == null ? null : Math.floor(n.uptime / (showDays ? 86400 : 3600));
  const stale = f && Date.parse(f.expires_at) <= now;
  return (
    <article
      className={`status-node-card min-w-0 rounded-[14px] border p-3.5 sm:p-[18px] sm:pb-[15px] ${n.online ? 'bg-surface border-border' : 'bg-[var(--danger-muted)] border-danger'} flex flex-col gap-3 text-(length:--text-sm) tabular-nums`}
    >
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <h2
            className={`flex items-start gap-2 text-base font-semibold ${n.online ? '' : 'text-danger'}`}
          >
            <CountryFlag code={n.country} standalone className="mt-1" />
            {link ? (
              <Link
                className="min-w-0 wrap-anywhere hover:text-accent"
                to={`/status/${encodeURIComponent(n.id)}`}
              >
                {n.alias}
              </Link>
            ) : (
              <span className="min-w-0 wrap-anywhere">{n.alias}</span>
            )}
          </h2>
          {(n.group || n.ipv4 || n.ipv6 || !n.online) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {n.group && (
                <Badge className="max-w-full" title={n.group}>
                  {n.group}
                </Badge>
              )}
              {[n.ipv4 ? 'V4' : '', n.ipv6 ? 'V6' : ''].filter(Boolean).map((label) => (
                <Badge
                  key={label}
                  tone="success"
                  outline
                  size="sm"
                  title={n.ip_at ? stamp(n.ip_at) : undefined}
                >
                  {label}
                </Badge>
              ))}
              {!n.online && <Badge tone="danger">离线</Badge>}
            </div>
          )}
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              aria-label={`节点信息，${n.os || '系统未知'}，采样与账期`}
              title={n.os || '采样与账期'}
              className="size-[30px]! min-h-0! min-w-0! p-0!"
            >
              <NodeOSIcon os={n.os} />
            </Button>
          </PopoverTrigger>
          <PopoverContent>
            <p>{n.os || '系统未知'}</p>
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
      </header>
      <div className="grid grid-cols-2 gap-x-3 sm:gap-x-5 gap-y-3.5">
        <Reading
          icon={Cpu}
          color="var(--metric-cpu)"
          name="CPU"
          reading={percent(level)}
          detail={n.cpu_cores ? `${n.cpu_cores} 核` : '核数未登记'}
          ratio={level}
        />
        <Reading
          icon={MemoryStick}
          color="var(--metric-memory)"
          name="内存"
          reading={percent(ram)}
          detail={`${bytes(f?.ram_used)} / ${bytes(f?.ram_total)}`}
          ratio={ram}
        />
        <Reading
          icon={HardDrive}
          color="var(--metric-disk)"
          name="磁盘"
          reading={percent(disk)}
          detail={`${bytes(d?.disk_used)} / ${bytes(d?.disk_total)}`}
          ratio={disk}
        />
        <Reading
          icon={Gauge}
          color="var(--metric-load_one)"
          name="负载"
          reading={fixed(d?.load1)}
          detail={`${fixed(d?.load1)} / ${fixed(d?.load5)} / ${fixed(d?.load15)}`}
          ratio={n.cpu_cores && d?.load1 != null ? (100 * d.load1) / n.cpu_cores : null}
        />
      </div>
      {(!f || stale || d?.stale) && (
        <p className="text-(length:--text-xs) text-text-secondary">
          {!f ? '等待资源采样' : stale ? '资源采样已过期' : '磁盘与负载采样已过期'}
        </p>
      )}
      <div className="grid grid-cols-2 gap-x-3 sm:gap-x-5 gap-y-2 border-t border-border pt-3 text-xs">
        <Traffic node={n} direction="tx" now={now} />
        <Traffic node={n} direction="rx" now={now} />
      </div>
      <div className="space-y-2 border-t border-border pt-3 text-xs text-text-secondary">
        <div className="flex flex-wrap items-center justify-between gap-1">
          <span className="inline-flex items-center gap-1.5">
            <Database size={14} />
            剩余流量{' '}
            <strong>
              {quota === 0n
                ? ''
                : quota != null && usage != null
                  ? bytes(quota > usage ? quota - usage : 0n)
                  : '—'}
            </strong>
          </span>
          <span>
            {bytes(usage)} / {quota === 0n ? '♾️' : bytes(quota)}
          </span>
        </div>
        <Segments
          ratio={usage != null && quota ? (100 * Number(usage)) / Number(quota) : null}
          color="var(--success)"
        />
      </div>
      <section className="space-y-2 border-t border-border py-3">
        <h3 className="sr-only">TCP 线路质量</h3>
        {n.lines.length ? (
          <ul className="grid gap-1">
            {n.lines.map((line) => (
              <Quality key={line.slot} line={line} now={Date.parse(snapshotAt)} />
            ))}
          </ul>
        ) : (
          <span className="text-text-secondary">尚未配置探测线路</span>
        )}
      </section>
      <footer className="mt-auto space-y-3 text-(length:--text-xs) font-medium text-text-secondary">
        <dl className="grid grid-cols-2 gap-3 sm:gap-5">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <dt className="inline-flex items-center gap-2">
              <RefreshCw size={13} aria-hidden />
              {n.online ? '在线' : '运行'}
            </dt>
            <dd className="ml-auto" title={n.uptime_at ? stamp(n.uptime_at) : undefined}>
              <span className="sr-only">系统运行时长</span>
              {age == null ? (
                '未知'
              ) : (
                <>
                  <strong className="text-base font-semibold text-(--info)">{age}</strong>
                  <span className="ml-0.5">{showDays ? '天' : '小时'}</span>
                </>
              )}
            </dd>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-1">
            <dt className="inline-flex items-center gap-2">
              <CalendarDays size={13} aria-hidden />
              到期
            </dt>
            <dd className="ml-auto" title={n.expires ? stamp(n.expires) : undefined}>
              {n.expires ? (
                renew(n.expires, now)
              ) : (
                <>
                  <span aria-hidden className="text-base">
                    —
                  </span>
                  <span className="sr-only">未登记</span>
                </>
              )}
            </dd>
          </div>
        </dl>
        <div className="flex flex-wrap items-center gap-1.5">
          {Array.from(new Set(n.tags.filter(Boolean))).map((label) => (
            <Badge key={label} className="max-w-full" title={label}>
              <span className="whitespace-normal wrap-anywhere">{label}</span>
            </Badge>
          ))}
          <Badge
            tone={n.price == null ? 'neutral' : 'success'}
            outline
            icon={<CircleDollarSign aria-hidden />}
          >
            {n.price == null
              ? '价格未登记'
              : Number(n.price) === 0
                ? '免费'
                : `${n.price} ${n.currency} / ${n.months === 1 ? '月' : `${n.months} 个月`}`}
          </Badge>
        </div>
      </footer>
    </article>
  );
}
