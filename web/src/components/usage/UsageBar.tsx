import { motion, useReducedMotion } from 'motion/react';
import { motionTokens } from '@/components/arc/lib/motion-tokens';

import { usageColor } from '@/utils/usage-tone';

export function UsageBar({ value, label }: { value?: number; label?: string }) {
  const reduceMotion = useReducedMotion();
  const percent =
    value !== undefined && Number.isFinite(value) && value >= 0 ? Math.min(value, 100) : undefined;
  return (
    <span
      role="progressbar"
      aria-hidden={label ? undefined : true}
      aria-label={label ?? '使用率'}
      aria-valuenow={label ? percent : undefined}
      aria-valuetext={
        label ? (percent === undefined ? '未知' : `${value?.toFixed(1)}%`) : undefined
      }
      className="block h-1.5 w-full overflow-hidden rounded-full bg-(--usage-track)"
    >
      {percent !== undefined && (
        <motion.span
          className="block h-full rounded-full"
          style={{ backgroundColor: usageColor(percent) }}
          initial={false}
          animate={{ width: `${percent}%` }}
          transition={reduceMotion ? { duration: 0 } : motionTokens.spring.smooth}
        />
      )}
    </span>
  );
}
