import { ChevronDown, type LucideIcon } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { Button } from '@/components/arc/button/button';

// Compose an Arc button with a labelled region: each settings group opens independently.
export function SettingSection({
  title,
  icon: Icon,
  children,
  summary,
}: {
  title: string;
  icon: LucideIcon;
  children: ReactNode;
  summary?: string;
}) {
  const [open, setOpen] = useState(true);
  const id = useId();
  return (
    <section
      className="@container min-w-0 rounded-(--radius-panel) border-[1px] border-border bg-surface px-5 sm:px-6"
      aria-labelledby={`${id}-heading`}
    >
      <div className="flex min-h-16 items-center justify-between gap-3">
        <h2 id={`${id}-heading`} className="flex items-center gap-3 font-medium">
          <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
          {title}
        </h2>
        <div className="flex min-w-0 items-center gap-3">
          <span className="truncate text-(length:--text-xs) text-text-secondary">
            {!open && summary}
          </span>
          <Button
            type="button"
            variant="ghost"
            className="size-11 shrink-0 p-0"
            aria-label={`${open ? '收起' : '展开'}${title}`}
            aria-expanded={open}
            aria-controls={`${id}-content`}
            onClick={() => setOpen(!open)}
          >
            <ChevronDown size={16} aria-hidden="true" className={open ? 'rotate-180' : ''} />
          </Button>
        </div>
      </div>
      <div id={`${id}-content`} hidden={!open} className="border-t-[1px] border-border pb-1">
        {children}
      </div>
    </section>
  );
}

export function SettingRow({
  title,
  description,
  children,
  wide = false,
}: {
  title: string;
  description: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4 border-b-[1px] border-border py-5 last:border-0 @min-[36rem]:flex-row @min-[36rem]:items-center @min-[36rem]:justify-between">
      <div className="min-w-0 flex-1 space-y-1.5">
        <h3 className="font-medium text-foreground">{title}</h3>
        <p className="text-(length:--text-xs) leading-relaxed text-text-secondary">{description}</p>
      </div>
      <div
        className={`${wide ? 'w-full @min-[36rem]:w-64' : 'w-fit'} min-w-0 max-w-full shrink-0 @min-[36rem]:max-w-[52%]`}
      >
        {children}
      </div>
    </div>
  );
}
