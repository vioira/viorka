import { type ReactNode, useId } from 'react';

export default function SettingsSection({
  title,
  description,
  children,
  layout = 'card',
}: {
  title: string;
  description?: string;
  children: ReactNode;
  layout?: 'card' | 'split';
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={
        layout === 'split'
          ? 'grid min-w-0 gap-6 py-8 first:pt-2 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:gap-10'
          : 'min-w-0 rounded-(--radius-surface) border-[0.5px] border-border bg-(--surface) p-5 sm:p-6'
      }
    >
      <div className="min-w-0">
        <h2 id={id} className="font-medium text-foreground">
          {title}
        </h2>
        {description && (
          <p className="mt-2 text-(length:--text-xs) text-text-secondary leading-relaxed">
            {description}
          </p>
        )}
      </div>
      <div className={layout === 'split' ? 'min-w-0 space-y-5' : 'mt-5 space-y-5'}>{children}</div>
    </section>
  );
}
