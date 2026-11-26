import { BadgeDollarSign } from 'lucide-react';
import type { StatusNode } from '@/api/public-status';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/arc/popover/popover';

function priceLabel(node: StatusNode) {
  if (node.price == null) return '价格未设置';
  if (Number(node.price) === 0) return '免费';
  const price = `${node.price} ${node.currency}`;
  if (!node.months) return price;
  return `${price} / ${node.months === 1 ? '月' : `${node.months} 个月`}`;
}

export default function RenewalReminder({ nodes, now }: { nodes: StatusNode[]; now: number }) {
  const due = nodes
    .filter(
      (n): n is StatusNode & { expires: string } =>
        n.expires !== null && Date.parse(n.expires) - now <= 7 * 86400000,
    )
    .sort((a, b) => Date.parse(a.expires) - Date.parse(b.expires));
  const expired = due.filter((node) => Date.parse(node.expires) <= now).length;
  const upcoming = due.length - expired;
  const summary = [
    expired > 0 && `${expired} 台节点已到期`,
    upcoming > 0 && `${upcoming} 台节点将在 7 天内到期`,
  ]
    .filter(Boolean)
    .join('，');

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          aria-label={`续费提醒（${due.length}）`}
          className="relative size-7.5! min-h-0! min-w-0! p-0!"
        >
          <BadgeDollarSign size={15} />
          {due.length > 0 && (
            <span aria-hidden className="absolute right-0 top-0 size-2 rounded-full bg-danger" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label="续费提醒"
        className="flex w-90 max-h-(--radix-popover-content-available-height) flex-col gap-3 overflow-y-auto tabular-nums"
      >
        <header className="flex items-start justify-between gap-2 px-1">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-medium">续费提醒</h2>
              <Badge tone={due.length ? 'warning' : 'neutral'} size="sm" pill>
                {due.length}
              </Badge>
            </div>
            <p className="text-xs text-text-secondary">{summary || '当前范围内没有待续费节点。'}</p>
          </div>
        </header>
        {due.length > 0 && (
          <ul className="space-y-2">
            {due.map((node) => {
              const days = Math.ceil((Date.parse(node.expires) - now) / 86400000);
              return (
                <li
                  key={node.id}
                  className="flex items-center justify-between gap-3 rounded-(--radius-control) border border-border bg-surface px-3 py-2"
                >
                  <div className="min-w-0 space-y-1 wrap-anywhere">
                    <p className="text-sm font-medium">{node.alias}</p>
                    <div className="flex flex-wrap gap-x-3 text-xs text-text-secondary">
                      <time
                        dateTime={node.expires}
                        title={new Date(node.expires).toLocaleDateString()}
                      >
                        {days > 0
                          ? `${days} 天后到期`
                          : new Date(node.expires).toLocaleDateString()}
                      </time>
                      <span>{priceLabel(node)}</span>
                    </div>
                  </div>
                  <Badge size="sm" tone="danger" className="shrink-0">
                    {days > 0 ? '即将到期' : '已到期'}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
