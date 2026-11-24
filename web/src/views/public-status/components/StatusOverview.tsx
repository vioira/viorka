import { BadgeDollarSign, Info } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { StatusNode, StatusPage } from '@/api/public-status';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';
import { Select } from '@/components/arc/select/select';
import { bytes, flag, renew, rentalValue, speed } from '../format';
import NodeCard from './NodeCard';

function total<T>(items: T[], read: (v: T) => number | null) {
  let value = 0,
    count = 0;
  for (const row of items) {
    const n = read(row);
    if (n != null) {
      value += n;
      count++;
    }
  }
  return { value, count };
}
const summaryCard =
  'relative min-w-0 min-h-[100px] sm:min-h-28 flex flex-col justify-between gap-2 rounded-2xl border border-border bg-surface p-3 sm:px-4 sm:py-3.5 tabular-nums';
function Summary({
  nodes,
  rates,
  now,
}: {
  nodes: StatusNode[];
  rates: StatusPage['rates'];
  now: number;
}) {
  const fresh = nodes.filter(
    (n) => n.fast && Date.parse(n.fast.expires_at) > now && n.fast.rx != null && n.fast.tx != null,
  );
  const rx = total(fresh, (n) => n.fast?.rx ?? null).value,
    tx = total(fresh, (n) => n.fast?.tx ?? null).value;
  const measured = nodes.flatMap((n) => (n.lifetime ? [n.lifetime] : []));
  const inbound = measured.reduce((v, n) => v + BigInt(n.rx), 0n),
    outbound = measured.reduce((v, n) => v + BigInt(n.tx), 0n);
  const value = total(nodes, (n) => rentalValue(n, rates, now));
  const due = nodes
    .filter(
      (n): n is StatusNode & { expires: string } =>
        n.expires !== null && Date.parse(n.expires) - now <= 7 * 86400000,
    )
    .sort((a, b) => Date.parse(a.expires) - Date.parse(b.expires));
  const dates = new Set<string>();
  for (const n of nodes) {
    if (
      !n.price ||
      Number(n.price) === 0 ||
      n.currency === 'CNY' ||
      !n.expires ||
      Date.parse(n.expires) <= now
    )
      continue;
    for (const c of ['CNY', n.currency]) {
      const date = rates.quotes?.[c]?.date;
      if (date) dates.add(date);
    }
  }
  const online = nodes.filter((n) => n.online).length;
  const amount = Number(inbound + outbound);
  return (
    <section aria-label="当前筛选范围汇总" className="space-y-3">
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        <article className={summaryCard}>
          <span className="text-xs font-medium tracking-wider text-text-secondary">在线节点</span>
          <strong className="text-2xl font-semibold">
            {online}
            <small className="ml-1 text-sm text-text-secondary">/ {nodes.length}</small>
          </strong>
          <div
            aria-hidden
            className={`mt-auto h-1.5 overflow-hidden rounded-full ${nodes.length ? 'bg-danger' : 'bg-border'}`}
          >
            <div
              className="h-full bg-success"
              style={{ width: `${nodes.length ? (online * 100) / nodes.length : 0}%` }}
            />
          </div>
        </article>
        <Stat
          label="实时带宽"
          action={
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="ghost" aria-label="分级依据" className="size-6! min-w-0! p-0!">
                  <Info size={14} />
                </Button>
              </DialogTrigger>
              <DialogContent title="汇总分级">
                <p>实时带宽为上下行之和。0 B/s 为空闲，低于 1 MB/s 为轻载，达到 1 MB/s 为活跃。</p>
                <p>
                  累计流量以 100 GB 和 1 TB 为中度、重度起点。剩余租期估值按 1,000 元和 10,000
                  元分档。各项优先显示数据覆盖情况。
                </p>
              </DialogContent>
            </Dialog>
          }
          formatted={speed(rx + tx)}
          known={fresh.length > 0}
          compactContext={`↑ ${fresh.length ? speed(tx) : '—'}　↓ ${fresh.length ? speed(rx) : '—'}`}
          context={`上行 ${fresh.length ? speed(tx) : '—'}，下行 ${fresh.length ? speed(rx) : '—'}`}
          grade={
            !nodes.length
              ? '暂无读数'
              : fresh.length < nodes.length
                ? `有读数 ${fresh.length}/${nodes.length}`
                : rx + tx === 0
                  ? '空闲'
                  : rx + tx < 1e6
                    ? '轻载'
                    : '活跃'
          }
        />
        <Stat
          label="累计流量"
          formatted={bytes(amount)}
          known={measured.length > 0}
          compactContext={`↑ ${measured.length ? bytes(outbound) : '—'}　↓ ${measured.length ? bytes(inbound) : '—'}`}
          context={`出站 ${measured.length ? bytes(outbound) : '—'}，入站 ${measured.length ? bytes(inbound) : '—'}`}
          grade={
            !nodes.length
              ? '暂无读数'
              : measured.length < nodes.length
                ? `有记录 ${measured.length}/${nodes.length}`
                : measured.some((m) => m.partial)
                  ? '记录不完整'
                  : amount >= 1e12
                    ? '重度'
                    : amount >= 1e11
                      ? '中度'
                      : '轻度'
          }
        />
        <Stat
          label="资产概览"
          action={
            <Dialog>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label={`续费提醒（${due.length}）`}
                  className="relative size-6! min-w-0! p-0!"
                >
                  <BadgeDollarSign size={15} />
                  {due.length > 0 && (
                    <span
                      aria-hidden
                      className="absolute right-0 top-0 size-2 rounded-full bg-danger"
                    />
                  )}
                </Button>
              </DialogTrigger>
              <DialogContent title="已到期及未来 7 天到期">
                {due.length ? (
                  <ul className="space-y-2">
                    {due.map((n) => (
                      <li key={n.id}>
                        {n.alias}　{renew(n.expires, now)}　
                        {new Date(n.expires).toLocaleDateString()}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>当前范围内没有待续费节点。</p>
                )}
              </DialogContent>
            </Dialog>
          }
          formatted={value.value.toLocaleString('zh-CN', { style: 'currency', currency: 'CNY' })}
          known={value.count > 0}
          context={
            dates.size ? `汇率日期 ${[...dates].sort().join('、')}` : '剩余租期估值（人民币）'
          }
          grade={
            !nodes.length
              ? '暂无读数'
              : value.count < nodes.length
                ? `${nodes.length - value.count} 台未计入`
                : value.value >= 10000
                  ? '万元及以上'
                  : value.value >= 1000
                    ? '千元及以上'
                    : '千元以下'
          }
        />
      </div>
    </section>
  );
}
function Stat({
  label,
  formatted,
  action,
  known,
  context,
  compactContext,
  grade,
}: {
  label: string;
  formatted: string;
  action?: ReactNode;
  known: boolean;
  context: string;
  compactContext?: string;
  grade: string;
}) {
  return (
    <article className={summaryCard}>
      <div className="flex items-center justify-between gap-1 text-xs font-medium tracking-wider text-text-secondary">
        <span>{label}</span>
        <span className="absolute top-2 right-3">{action}</span>
      </div>
      <strong
        className={`wrap-anywhere text-2xl sm:text-[28px] font-semibold leading-tight ${label === '实时带宽' && known ? 'text-warning' : ''}`}
      >
        {known ? formatted.split(' ')[0] : '—'}{' '}
        <small className="text-sm font-medium text-text-secondary">
          {known ? formatted.split(' ').slice(1).join(' ') : ''}
        </small>
      </strong>
      <div className="flex flex-wrap items-end justify-between gap-1 text-xs text-text-secondary">
        <span className={compactContext ? 'sr-only sm:not-sr-only' : undefined}>{context}</span>
        {compactContext && (
          <span className="sm:hidden" aria-hidden>
            {compactContext.split('　').map((value) => (
              <span key={value} className="mr-1 inline-block whitespace-nowrap">
                {value}
              </span>
            ))}
          </span>
        )}
        <strong className="font-medium text-accent">{grade}</strong>
      </div>
    </article>
  );
}
export default function StatusOverview({
  page,
  now,
  preview = false,
}: {
  page: StatusPage;
  now: number;
  preview?: boolean;
}) {
  const [group, setGroup] = useState<string | null>(null),
    [country, setCountry] = useState<string | null>(null),
    [sort, setSort] = useState('default');
  const grouped = page.nodes.filter((n) => group === null || n.group === group),
    countries = new Map<string, number>();
  for (const n of grouped) countries.set(n.country, (countries.get(n.country) ?? 0) + 1);
  const nodes = grouped.filter((n) => country === null || n.country === country);
  const bandwidth = (n: StatusNode) =>
    n.fast && Date.parse(n.fast.expires_at) > now && n.fast.rx != null && n.fast.tx != null
      ? n.fast.rx + n.fast.tx
      : -1;
  if (sort === 'name') nodes.sort((a, b) => a.alias.localeCompare(b.alias, 'zh-CN'));
  if (sort === 'bandwidth') nodes.sort((a, b) => bandwidth(b) - bandwidth(a));
  if (sort === 'expiry')
    nodes.sort(
      (a, b) =>
        (a.expires ? Date.parse(a.expires) : Infinity) -
        (b.expires ? Date.parse(b.expires) : Infinity),
    );
  return (
    <div className="space-y-2.5 sm:space-y-4">
      <Summary nodes={nodes} now={now} rates={page.rates} />
      <div className="space-y-2.5 sm:space-y-4">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:flex-wrap sm:justify-between sm:gap-3">
          <div
            aria-label="公开分组"
            role="group"
            className="flex min-w-0 max-w-full overflow-x-auto sm:flex-wrap gap-1 rounded-2xl border border-border bg-surface p-1"
          >
            {[null, ...new Set(page.nodes.map((n) => n.group).filter(Boolean))].map((g) => (
              <Button
                key={g ?? ''}
                aria-pressed={g === group}
                className="shrink-0 sm:min-w-20"
                title={g ?? '全部'}
                variant={g === group ? 'secondary' : 'ghost'}
                onClick={() => {
                  setGroup(g);
                  setCountry(null);
                }}
              >
                <span className="block max-w-36 truncate">{g ?? '全部'}</span>
              </Button>
            ))}
          </div>
          <Select
            label="排序"
            hideLabel
            value={sort}
            onValueChange={setSort}
            options={[
              { value: 'default', label: '默认顺序' },
              { value: 'name', label: '按名称' },
              { value: 'bandwidth', label: '带宽从高到低' },
              { value: 'expiry', label: '到期从近到远' },
            ]}
          />
        </div>
        <div
          aria-label="地区筛选"
          role="group"
          className="flex overflow-x-auto items-center gap-1 rounded-2xl border border-border bg-surface p-1 sm:flex-wrap sm:gap-2 sm:px-3 sm:py-2"
        >
          {[...countries].map(([code, count]) => (
            <Button
              key={code}
              className="shrink-0"
              variant={country === code ? 'secondary' : 'ghost'}
              aria-pressed={country === code}
              onClick={() => setCountry(country === code ? null : code)}
            >
              {flag(code)} {code || '未知地区'}{' '}
              <small className="rounded-md bg-surface-raised px-1.5 text-xs">{count}</small>
            </Button>
          ))}
        </div>
      </div>
      {nodes.length ? (
        <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {nodes.map((n) => (
            <NodeCard key={n.id} node={n} now={now} link={!preview} />
          ))}
        </div>
      ) : (
        <p>当前范围内没有公开节点。</p>
      )}
    </div>
  );
}
