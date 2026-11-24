import { useState } from 'react';
import type { StatusNode, StatusPage } from '@/api/public-status';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';
import { MetricCard } from '@/components/arc/metric-card/metric-card';
import { Select } from '@/components/arc/select/select';
import { bytes, cardClass, flag, renew, rentalValue, speed } from '../format';
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
  const amount = Number(inbound + outbound);
  return (
    <section aria-label="当前筛选范围汇总" className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="relative">
          <MetricCard
            label="在线节点"
            value={nodes.filter((n) => n.online).length}
            suffix={` / ${nodes.length}`}
            context="Agent 管理连接"
          />
          <div
            aria-hidden="true"
            className="absolute inset-x-5 bottom-3 h-1 overflow-hidden rounded-full bg-surface-raised"
          >
            <div
              className="h-full bg-success"
              style={{
                width: `${nodes.length ? (100 * nodes.filter((n) => n.online).length) / nodes.length : 0}%`,
              }}
            />
          </div>
        </div>
        <Stat
          label="实时带宽"
          formatted={speed(rx + tx)}
          known={fresh.length > 0}
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
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="ghost">分级依据</Button>
          </DialogTrigger>
          <DialogContent title="汇总分级">
            <p>实时带宽为上下行之和。0 B/s 为空闲，低于 1 MB/s 为轻载，达到 1 MB/s 为活跃。</p>
            <p>
              累计流量以 100 GB 和 1 TB 为中度、重度起点。剩余租期估值按 1,000 元和 10,000
              元分档。各项优先显示数据覆盖情况。
            </p>
          </DialogContent>
        </Dialog>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="secondary">续费提醒（{due.length}）</Button>
          </DialogTrigger>
          <DialogContent title="已到期及未来 7 天到期">
            {due.length ? (
              <ul className="space-y-2">
                {due.map((n) => (
                  <li key={n.id}>
                    {n.alias}　{renew(n.expires, now)}　{new Date(n.expires).toLocaleDateString()}
                  </li>
                ))}
              </ul>
            ) : (
              <p>当前范围内没有待续费节点。</p>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </section>
  );
}
function Stat({
  label,
  formatted,
  known,
  context,
  grade,
}: {
  label: string;
  formatted: string;
  known: boolean;
  context: string;
  grade: string;
}) {
  return (
    <article className={`${cardClass} flex flex-col justify-between gap-3`}>
      <div className="flex flex-wrap items-center justify-between gap-1 text-(length:--text-sm)">
        <span>{label}</span>
        <span className="text-(length:--text-xs) text-text-secondary">{grade}</span>
      </div>
      <strong className="break-words text-(length:--text-2xl) font-medium tabular-nums">
        {known ? formatted : '—'}
      </strong>
      <p className="text-(length:--text-xs) text-text-secondary">{context}</p>
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
    <div className="space-y-4">
      <Summary nodes={nodes} now={now} rates={page.rates} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div aria-label="公开分组" role="group" className="flex flex-wrap gap-2">
          {[null, ...new Set(page.nodes.map((n) => n.group).filter(Boolean))].map((g) => (
            <Button
              key={g ?? ''}
              aria-pressed={g === group}
              variant={g === group ? 'primary' : 'secondary'}
              onClick={() => {
                setGroup(g);
                setCountry(null);
              }}
            >
              {g ?? '全部分组'}
            </Button>
          ))}
        </div>
        <Select
          label="排序"
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
      <div aria-label="地区筛选" role="group" className="flex flex-wrap gap-2">
        <Button variant="ghost" aria-pressed={country === null} onClick={() => setCountry(null)}>
          全部地区
        </Button>
        {[...countries].map(([code, count]) => (
          <Button
            key={code}
            variant={country === code ? 'secondary' : 'ghost'}
            aria-pressed={country === code}
            onClick={() => setCountry(country === code ? null : code)}
          >
            {flag(code)} {code || '未知地区'} {count}
          </Button>
        ))}
      </div>
      {nodes.length ? (
        <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
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
