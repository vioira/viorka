import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { StatusNode } from '@/api/public-status';
import { Button } from '@/components/arc/button/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/arc/popover/popover';
import { SearchField } from '@/components/arc/search-field/search-field';
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
  const [query, setQuery] = useState('');
  const [onlineOnly, setOnlineOnly] = useState(false);
  const navigate = useNavigate();
  const { search } = useLocation();
  const region = statusRegion(current);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return nodes.filter((item) => {
      if (onlineOnly && !item.online) return false;
      if (!keyword) return true;
      return (
        item.alias.toLowerCase().includes(keyword) ||
        item.group.toLowerCase().includes(keyword) ||
        statusRegion(item).toLowerCase().includes(keyword) ||
        item.country.toLowerCase().includes(keyword)
      );
    });
  }, [nodes, onlineOnly, query]);

  const currentIndex = nodes.findIndex((item) => item.id === current.id);
  const prevNode =
    nodes.length > 1 && currentIndex >= 0
      ? nodes[(currentIndex - 1 + nodes.length) % nodes.length]
      : null;
  const nextNode =
    nodes.length > 1 && currentIndex >= 0 ? nodes[(currentIndex + 1) % nodes.length] : null;

  const goToNode = (id: string) => {
    setOpen(false);
    setQuery('');
    if (id !== current.id) {
      void navigate(`/status/${encodeURIComponent(id)}${search}`, {
        preventScrollReset: true,
      });
    }
  };

  return (
    <div className="flex min-w-0 max-w-full items-center gap-1.5">
      <div className="min-w-0 max-w-full sm:max-w-96">
        <Popover
          open={open}
          onOpenChange={(nextOpen) => {
            setOpen(nextOpen);
            if (!nextOpen) setQuery('');
          }}
        >
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
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            aria-label="切换公开节点"
            className="w-80 max-w-[calc(100vw-2rem)]"
            style={{ padding: 10, borderRadius: 'calc(var(--radius-control) + 8px)' }}
          >
            <div className="space-y-2.5">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <SearchField
                    label="搜索公开节点"
                    hideLabel
                    placeholder="搜索别名、分组或地区"
                    value={query}
                    onValueChange={setQuery}
                  />
                </div>
                <Button
                  variant={onlineOnly ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-pressed={onlineOnly}
                  onClick={() => setOnlineOnly((value) => !value)}
                >
                  仅看在线
                </Button>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {filtered.length > 0 ? (
                  <ul className="space-y-1" aria-label="公开节点列表">
                    {filtered.map((item) => {
                      const selected = item.id === current.id;
                      const itemRegion = statusRegion(item);
                      return (
                        <li key={item.id}>
                          <Button
                            variant="ghost"
                            className="w-full justify-start rounded-(--radius-control)"
                            style={{
                              minHeight: 56,
                              padding: '8px 10px',
                              ...(selected ? { background: 'var(--accent-subtle)' } : {}),
                            }}
                            aria-current={selected ? 'page' : undefined}
                            aria-label={`${item.alias}，${item.online ? '在线' : '离线'}，${statusNodeKind(item.kind)}${selected ? '，当前节点' : ''}`}
                            onClick={() => goToNode(item.id)}
                          >
                            <span className="flex w-full min-w-0 items-center justify-between gap-3 text-left">
                              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <span
                                  className="truncate font-medium text-foreground"
                                  title={item.alias}
                                >
                                  {item.alias}
                                </span>
                                <span
                                  className="truncate text-(length:--text-xs) font-normal text-text-secondary"
                                  title={`${item.group ? `${item.group} ` : ''}${itemRegion}`}
                                >
                                  {item.group ? `${item.group} ` : ''}
                                  <CountryFlag code={item.country} className="mr-1" />
                                  {itemRegion}
                                </span>
                              </span>
                              <span
                                className={`flex shrink-0 items-center gap-1.5 text-(length:--text-xs) font-medium ${item.online ? 'text-success' : 'text-danger'}`}
                              >
                                <span
                                  aria-hidden="true"
                                  className="size-1.5 shrink-0 rounded-full bg-current"
                                />
                                {item.online ? '在线' : '离线'}
                              </span>
                            </span>
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="py-6 text-center text-(length:--text-xs) text-text-secondary">
                    没有匹配的公开节点
                  </p>
                )}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {prevNode && nextNode && (
        <div
          className="hidden items-center gap-1 sm:inline-flex"
          role="group"
          aria-label="相邻节点"
        >
          <Button
            variant="secondary"
            size="sm"
            aria-label={`上一节点：${prevNode.alias}`}
            title={`上一节点：${prevNode.alias}`}
            onClick={() => goToNode(prevNode.id)}
          >
            <ChevronLeft size={15} aria-hidden="true" />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            aria-label={`下一节点：${nextNode.alias}`}
            title={`下一节点：${nextNode.alias}`}
            onClick={() => goToNode(nextNode.id)}
          >
            <ChevronRight size={15} aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  );
}
