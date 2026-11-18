import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/arc/skeleton/skeleton';

export default function InitialSkeleton({
  label,
  lines = 3,
  className = '',
}: {
  label: string;
  lines?: number;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 200);
    return () => clearTimeout(timer);
  }, []);
  return (
    <Skeleton
      label={label}
      lines={lines}
      className={visible ? className : `invisible ${className}`}
    />
  );
}
