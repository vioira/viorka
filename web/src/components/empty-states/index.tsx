import type { ReactNode } from 'react';
import { EmptyState } from '@/components/arc/empty-state/empty-state';
import { useTheme } from '@/hooks/use-theme';

export type StateIllustration =
  | 'empty'
  | 'no-results'
  | 'offline'
  | 'not-found'
  | 'bad-gateway'
  | 'success'
  | 'error'
  | 'forbidden'
  | 'maintenance'
  | 'pending'
  | 'partial'
  | 'unconfigured';

export interface EmptyStatesProps {
  title: string;
  description?: string;
  variant?: StateIllustration | 'unknown';
  action?: ReactNode;
  className?: string;
  headingLevel?: 2 | 3;
  compact?: boolean;
}

/** Arc scene artwork with real, caller-owned state and actions. Unknown data has no empty illustration. */
export default function EmptyStates({
  title,
  description = '',
  variant = 'empty',
  action,
  className,
  headingLevel = 2,
  compact = false,
}: EmptyStatesProps) {
  const { dark } = useTheme();
  return (
    <EmptyState
      title={title}
      headingLevel={headingLevel}
      compact={compact}
      description={description}
      label={title}
      action={action}
      className={className}
      illustration={
        variant === 'unknown' ? null : (
          <img
            src={`/image/states/${dark ? 'dark' : 'light'}/${variant}.svg`}
            alt=""
            width={320}
            height={216}
            className={compact ? 'mx-auto block h-auto w-full max-w-32' : 'block h-auto w-full'}
          />
        )
      }
    />
  );
}
