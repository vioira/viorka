import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import {
  readStatusDirectory,
  type StatusDirectoryNode,
  type StatusNode,
} from '@/api/public-status';
import { Button } from '@/components/arc/button/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/arc/popover/popover';
import { SearchField } from '@/components/arc/search-field/search-field';
import { CountryFlag } from '@/components/country-flag';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import { statusNodeKind, statusRegion } from '../format';

export default function PublicNodeSwitcher({ current }: { current: StatusNode }) {
  const [directory, setDirectory] = useState<StatusDirectoryNode[] | null>(null);
  const [, report] = useToastFeedback('error', 'status-directory');
  const [refresh, setRefresh] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Opening the directory requests a fresh snapshot.
  useEffect(() => {
    const controller = new AbortController();
    readStatusDirectory(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setDirectory(value);
          report('');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) report('公开节点列表读取失败，请重新打开切换器。');
      });
    return () => controller.abort();
  }, [report, refresh]);
  return (
    <PublicNodeSwitcherMenu
      current={current}
      directory={directory}
      onOpen={() => setRefresh((n) => n + 1)}
    />
  );
}

export function PublicNodeSwitcherMenu({
  current,
  directory,
  onOpen,
}: {
  current: StatusNode;
  directory: StatusDirectoryNode[] | null;
  onOpen: () => void;
}) {
  const [open, setOpen] = useState(false);
  const nodes = useMemo(
    () => directory?.map((item) => (item.id === current.id ? current : item)) ?? [],
    [directory, current],
  );
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
            if (nextOpen) onOpen();
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
            className="w-90 max-w-[calc(100vw-2rem)]"
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
                          <Link
                            to={`/status/${encodeURIComponent(item.id)}${search}`}
                            preventScrollReset
                            className="flex min-h-14 w-full items-center justify-between gap-3 rounded-(--radius-control) px-3 py-2 text-left text-(length:--text-sm) hover:bg-surface-muted aria-[current=page]:bg-(--accent-subtle)"
                            aria-current={selected ? 'page' : undefined}
                            aria-label={`${item.alias}，${item.online ? '在线' : '离线'}，${statusNodeKind(item.kind)}${selected ? '，当前节点' : ''}`}
                            onClick={(event) => {
                              if (selected) event.preventDefault();
                              setOpen(false);
                              setQuery('');
                            }}
                          >
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
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="py-6 text-center text-(length:--text-xs) text-text-secondary">
                    {directory ? '没有匹配的公开节点' : '尚未读取公开节点列表'}
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
