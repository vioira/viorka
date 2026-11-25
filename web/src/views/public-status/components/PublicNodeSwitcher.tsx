import { Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { StatusNode } from '@/api/public-status';
import { Button } from '@/components/arc/button/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/arc/popover/popover';
import { CountryFlag } from '@/components/country-flag';
import { statusNodeKind, statusRegion } from '../format';

export default function PublicNodeSwitcher({
  nodes,
  current,
}: {
  nodes: StatusNode[];
  current: StatusNode;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { search } = useLocation();
  const region = statusRegion(current);

  return (
    <div className="min-w-0 max-w-full sm:max-w-96">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="secondary"
            className="max-w-full"
            aria-label={`切换公开节点，当前 ${current.alias}，${current.online ? '在线' : '离线'}，${region}`}
          >
            <span className="flex w-44 min-w-0 items-center gap-2 sm:w-64">
              <span
                aria-hidden="true"
                className={`size-2 shrink-0 rounded-full ${current.online ? 'bg-success' : 'bg-danger'}`}
              />
              <span className="min-w-0 truncate font-medium" title={current.alias}>
                {current.alias}
              </span>
              <span
                className="hidden min-w-0 truncate text-text-secondary sm:inline"
                title={region}
              >
                <CountryFlag code={current.country} className="mr-1" />
                {region}
              </span>
              <ChevronDown size={16} className="ml-auto shrink-0" aria-hidden="true" />
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          aria-label="切换公开节点"
          className="w-80"
          style={{ padding: 8, borderRadius: 'calc(var(--radius-control) + 8px)' }}
        >
          <div className="max-h-80 overflow-y-auto">
            <ul className="space-y-1" aria-label="公开节点列表">
              {nodes.map((item) => {
                const selected = item.id === current.id;
                const itemRegion = statusRegion(item);
                return (
                  <li key={item.id}>
                    <Button
                      variant="ghost"
                      className="w-full rounded-(--radius-control)"
                      style={{
                        minHeight: 60,
                        padding: '8px 12px',
                        ...(selected ? { background: 'var(--accent-subtle)' } : {}),
                      }}
                      aria-current={selected ? 'page' : undefined}
                      aria-label={`${item.alias}，${item.online ? '在线' : '离线'}，${statusNodeKind(item.kind)}${selected ? '，当前节点' : ''}`}
                      onClick={() => {
                        setOpen(false);
                        if (!selected) {
                          void navigate(`/status/${encodeURIComponent(item.id)}${search}`, {
                            preventScrollReset: true,
                          });
                        }
                      }}
                    >
                      <span className="flex w-64 min-w-0 items-center gap-3 text-left">
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="truncate font-medium text-foreground" title={item.alias}>
                            {item.alias}
                          </span>
                          <span
                            className="truncate text-(length:--text-xs) text-text-secondary"
                            title={`${item.group ? `${item.group} ` : ''}${itemRegion}`}
                          >
                            {item.group ? `${item.group} ` : ''}
                            <CountryFlag code={item.country} className="mr-1" />
                            {itemRegion}
                          </span>
                        </span>
                        <span
                          className={`flex shrink-0 items-center gap-1.5 text-(length:--text-xs) ${item.online ? 'text-success' : 'text-danger'}`}
                        >
                          <span
                            aria-hidden="true"
                            className="size-1.5 shrink-0 rounded-full bg-current"
                          />
                          {item.online ? '在线' : '离线'}
                        </span>
                        <span className="flex size-4 shrink-0 items-center text-accent">
                          {selected && <Check size={16} aria-hidden="true" />}
                        </span>
                      </span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
