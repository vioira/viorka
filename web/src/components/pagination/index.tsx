import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Ellipsis } from 'lucide-react';
import { type MouseEvent, useLayoutEffect, useRef } from 'react';
import { Button } from '@/components/arc/button/button';
import { Select } from '@/components/arc/select/select';
import { jumpPage, pageItems } from './pages';

type PaginationProps = {
  label: string;
  page: number;
  onPageChange: (page: number) => void;
  busy?: boolean;
  pageSize?: { value: number; options: readonly number[]; onChange: (size: number) => void };
} & ({ pageCount: number; hasNext?: never } | { pageCount?: never; hasNext: boolean });

const pageButton =
  'min-w-(--control-height-md) px-2! tabular-nums aria-disabled:opacity-50 disabled:opacity-50!';

export default function Pagination({
  label,
  page,
  pageCount,
  hasNext,
  onPageChange,
  busy = false,
  pageSize,
}: PaginationProps) {
  const last = Math.max(1, pageCount ?? page + Number(hasNext));
  const current = Math.min(Math.max(1, page), last);
  const items = pageItems(current, last);
  const selectedSize = pageSize?.value;
  const navigation = useRef<HTMLElement>(null);
  const lastTrigger = useRef<{ button: HTMLButtonElement; page: number } | null>(null);
  const sizeTrigger = useRef<HTMLButtonElement>(null);
  const sizeChanged = useRef(false);

  useLayoutEffect(() => {
    const trigger = lastTrigger.current;
    lastTrigger.current = null;
    const focused = document.activeElement;
    if (
      trigger?.page === current &&
      (!trigger.button.isConnected || trigger.button.disabled) &&
      (focused === document.body || focused === trigger.button)
    ) {
      navigation.current?.querySelector<HTMLButtonElement>('[aria-current="page"]')?.focus();
    }
  }, [current]);

  useLayoutEffect(() => {
    if (selectedSize === undefined || busy || !sizeChanged.current) return;
    sizeChanged.current = false;
    const trigger = sizeTrigger.current;
    // Arc normally returns focus when the menu closes. A request can disable the trigger first.
    if (trigger && document.activeElement?.contains(trigger)) trigger.focus();
  }, [busy, selectedSize]);

  function go(event: MouseEvent<HTMLButtonElement>, target: number) {
    if (busy || target < 1 || target > last || target === current) return;
    lastTrigger.current =
      event.currentTarget === document.activeElement
        ? { button: event.currentTarget, page: target }
        : null;
    onPageChange(target);
  }

  return (
    <nav
      ref={navigation}
      aria-label={label}
      className="flex min-w-0 flex-wrap items-center justify-end gap-x-4 gap-y-2"
    >
      <span role="status" className="sr-only">
        {pageCount === undefined ? `第 ${current} 页` : `第 ${current} 页，共 ${last} 页`}
      </span>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2" aria-busy={busy}>
        <Button
          type="button"
          variant="ghost"
          className={pageButton}
          aria-label="上一页"
          disabled={current === 1}
          aria-disabled={busy || undefined}
          onClick={(event) => go(event, current - 1)}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </Button>
        {items.map((item) => {
          if (typeof item === 'number') {
            const active = item === current;
            const hideOnNarrowScreen = items.length > 5 && item !== 1 && item !== last && !active;
            return (
              <Button
                key={item}
                type="button"
                variant={active ? 'secondary' : 'ghost'}
                className={`${pageButton} aria-[current=page]:border-accent!${hideOnNarrowScreen ? ' max-sm:hidden!' : ''}`}
                aria-current={active ? 'page' : undefined}
                aria-label={`第 ${item} 页`}
                aria-disabled={busy || undefined}
                onClick={(event) => go(event, item)}
              >
                {item}
              </Button>
            );
          }
          const target = jumpPage(current, last, item);
          const Arrow = item === 'back' ? ChevronsLeft : ChevronsRight;
          const jumpLabel = `向${item === 'back' ? '前' : '后'}跳到第 ${target} 页`;
          return (
            <Button
              key={item}
              type="button"
              variant="ghost"
              className={`${pageButton} group`}
              aria-label={jumpLabel}
              title={jumpLabel}
              aria-disabled={busy || undefined}
              onClick={(event) => go(event, target)}
            >
              <Ellipsis
                size={16}
                aria-hidden="true"
                className="group-hover:hidden group-focus-visible:hidden"
              />
              <Arrow
                size={16}
                aria-hidden="true"
                className="hidden group-hover:block group-focus-visible:block"
              />
            </Button>
          );
        })}
        <Button
          type="button"
          variant="ghost"
          className={pageButton}
          aria-label="下一页"
          disabled={current === last}
          aria-disabled={busy || undefined}
          onClick={(event) => go(event, current + 1)}
        >
          <ChevronRight size={16} aria-hidden="true" />
        </Button>
      </div>
      {pageSize && (
        <div className="w-32 shrink-0">
          <Select
            ref={sizeTrigger}
            label="每页条数"
            hideLabel
            className="border-border-strong! tabular-nums"
            value={String(pageSize.value)}
            options={pageSize.options.map((size) => ({
              value: String(size),
              label: `${size} 条/页`,
            }))}
            disabled={busy}
            onValueChange={(value) => {
              sizeChanged.current = true;
              pageSize.onChange(Number(value));
            }}
          />
        </div>
      )}
    </nav>
  );
}
