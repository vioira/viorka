import { type ReactNode, useId } from 'react';

export default function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="min-w-0 rounded-(--radius-surface) border-[0.5px] border-border bg-(--surface) p-5 sm:p-6"
    >
      <h2 id={id} className="font-medium text-foreground">
        {title}
      </h2>
      {description && (
        <p className="mt-2 text-(length:--text-xs) text-text-secondary leading-relaxed">
          {description}
        </p>
      )}
      <div className="mt-5 space-y-5">{children}</div>
    </section>
  );
}
