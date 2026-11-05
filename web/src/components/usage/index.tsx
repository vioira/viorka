import { motion, useReducedMotion } from 'motion/react';
import { motionTokens } from '@/components/arc/lib/motion-tokens';

interface UsageProps {
  value: number | null;
  /** Visible on compact table rows; still available to screen readers on desktop. */
  label?: string;
}

/** Compact percentage readout; the bar is decorative, the text keeps the measured value. */
export default function Usage({ value, label }: UsageProps) {
  const reduceMotion = useReducedMotion();
  const known = value !== null && Number.isFinite(value) && value >= 0;
  return (
    <span className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap tabular-nums">
      {label && <span className="min-[621px]:sr-only">{label}</span>}
      {known ? (
        <>
          <span
            aria-hidden="true"
            className="inline-block h-[5px] w-[76px] shrink-0 overflow-hidden rounded-full bg-(--usage-track)"
          >
            <motion.span
              className="block h-full rounded-full bg-(image:--usage-fill)"
              initial={false}
              animate={{ width: `${Math.min(value, 100)}%` }}
              transition={reduceMotion ? { duration: 0 } : motionTokens.spring.smooth}
            />
          </span>
          <span className="w-14 shrink-0 text-right">{Number(value.toFixed(1))}%</span>
        </>
      ) : (
        <span className="text-text-secondary">无数据</span>
      )}
    </span>
  );
}
