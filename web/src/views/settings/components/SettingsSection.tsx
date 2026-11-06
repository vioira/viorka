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
    <section aria-labelledby={id} className="v-card">
      <div className="min-w-0">
        <h2 id={id} className="v-card-title">
          {title}
        </h2>
        {description && <p className="v-card-description">{description}</p>}
      </div>
      <div className="mt-5 min-w-0 space-y-5">{children}</div>
    </section>
  );
}
