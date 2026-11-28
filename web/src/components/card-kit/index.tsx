import { Check, Copy } from 'lucide-react';
import type { MouseEvent } from 'react';
import { Badge } from '@/components/arc/badge/badge';
import { useCopyFeedback } from '@/components/arc/lib/use-copy-feedback';
import { Skeleton } from '@/components/arc/skeleton/skeleton';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';

const INTERACTIVE_SELECTOR =
  'a, button, input, select, textarea, label, [role="button"], [role="link"], [role="checkbox"], [role="menuitem"], [role="option"], [data-card-interactive]';

/** Returns true only when a card click did not originate from an interactive descendant or text selection. */
export function shouldHandleCardClick(event: MouseEvent<HTMLElement>): boolean {
  if (typeof window !== 'undefined' && window.getSelection?.()?.toString()) {
    return false;
  }
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(INTERACTIVE_SELECTOR)) {
    return false;
  }
  return true;
}

/** Compact inline copy button for public endpoints and target server addresses inside cards. */
export function EndpointCopyButton({
  value,
  label,
  ariaLabel,
}: {
  value: string;
  label: string;
  ariaLabel?: string;
}) {
  const { state, copy } = useCopyFeedback();
  const { toast } = useToastStack();

  async function handleCopy(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    const ok = await copy(value);
    toast({
      id: `endpoint-copy-${label}`,
      type: ok ? 'success' : 'error',
      title: ok ? `已复制${label}` : `未能复制${label}`,
      description: ok ? value : '请手动选择并复制该地址。',
    });
  }

  return (
    <button
      type="button"
      data-card-interactive="1"
      aria-label={ariaLabel ?? `复制${label}`}
      title={ariaLabel ?? `复制${label}`}
      onClick={(event) => void handleCopy(event)}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface hover:text-foreground"
    >
      {state === 'copied' ? (
        <Check size={14} strokeWidth={1.75} className="text-success" aria-hidden="true" />
      ) : (
        <Copy size={14} strokeWidth={1.75} aria-hidden="true" />
      )}
    </button>
  );
}

const SKELETON_SLOTS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9'] as const;

/** Skeleton card grid matching the target responsive column layout during initial fetch. */
export function CardGridSkeleton({
  count = 6,
  cols = '3col',
  label = '正在读取列表',
}: {
  count?: number;
  cols?: '2col' | '3col';
  label?: string;
}) {
  const gridClass =
    cols === '2col'
      ? 'grid grid-cols-1 gap-4 lg:grid-cols-2'
      : 'grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3';
  return (
    <section className={gridClass} aria-busy="true" aria-label={label}>
      {SKELETON_SLOTS.slice(0, Math.min(count, SKELETON_SLOTS.length)).map((slot, idx) => (
        <div
          key={slot}
          className="rounded-(--radius-surface) border-[1px] border-border bg-surface p-4"
        >
          <Skeleton lines={4} label={idx === 0 ? label : ''} />
        </div>
      ))}
    </section>
  );
}

export interface LensItem<T extends string> {
  key: T;
  label: string;
  count: number;
  dotClass?: string;
}

/** Responsive status lens strip: 4-cell bar on desktop/tablet, horizontally scrollable compact pills on mobile. */
export function LensStrip<T extends string>({
  items,
  activeKey,
  onChange,
  label,
  loaded,
}: {
  items: LensItem<T>[];
  activeKey: T;
  onChange: (key: T) => void;
  label: string;
  loaded: boolean;
}) {
  return (
    <>
      <div
        role="group"
        aria-label={label}
        className="flex items-center gap-1.5 overflow-x-auto py-0.5 sm:hidden"
      >
        {items.map((item) => {
          const active = activeKey === item.key;
          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(item.key)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-(--radius-control) border-[1px] px-3 py-1.5 text-(length:--text-xs) tabular-nums transition-colors ${
                active
                  ? 'border-(--table-row-selected-border) bg-(--accent-subtle) font-medium text-foreground'
                  : 'border-border bg-surface text-text-secondary hover:text-foreground'
              }`}
            >
              {item.dotClass && (
                <span
                  className={`size-1.5 shrink-0 rounded-full ${item.dotClass}`}
                  aria-hidden="true"
                />
              )}
              <span>{item.label}</span>
              <span className="font-medium text-foreground">{loaded ? item.count : '-'}</span>
            </button>
          );
        })}
      </div>

      <div
        role="group"
        aria-label={label}
        className="hidden grid-cols-4 divide-x-[1px] divide-border-subtle overflow-hidden rounded-(--radius-surface) border-[1px] border-border bg-surface sm:grid"
      >
        {items.map((item) => {
          const active = activeKey === item.key;
          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(item.key)}
              className={`flex items-center justify-between gap-2 px-4 py-3.5 text-left transition-colors ${
                active ? 'bg-(--accent-subtle)' : 'hover:bg-surface-muted/50'
              }`}
            >
              <div className="min-w-0">
                <p
                  className={`flex items-center gap-1.5 truncate text-(length:--text-xs) ${
                    active ? 'font-medium text-foreground' : 'text-text-secondary'
                  }`}
                >
                  {item.dotClass && (
                    <span
                      className={`size-1.5 shrink-0 rounded-full ${item.dotClass}`}
                      aria-hidden="true"
                    />
                  )}
                  <span className="truncate">{item.label}</span>
                </p>
                <p className="mt-1 text-(length:--text-lg) font-medium tabular-nums text-foreground">
                  {loaded ? item.count : '-'}
                </p>
              </div>
              {active && (
                <Badge size="sm" tone="neutral">
                  已选
                </Badge>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}
