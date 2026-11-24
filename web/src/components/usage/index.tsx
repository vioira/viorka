import { UsageBar } from './UsageBar';

interface UsageProps {
  value: number | null;
  /** Visible on compact table rows; still available to screen readers on desktop. */
  label?: string;
}

/** Compact percentage readout; the bar is decorative, the text keeps the measured value. */
export default function Usage({ value, label }: UsageProps) {
  const known = value !== null && Number.isFinite(value) && value >= 0;
  return (
    <span className="inline-flex w-20 shrink-0 flex-col items-center gap-1 whitespace-nowrap tabular-nums">
      {label && <span className="min-[621px]:sr-only">{label}</span>}
      {known ? (
        <>
          <span>{Number(value.toFixed(1))}%</span>
          <UsageBar value={value} />
        </>
      ) : (
        <span className="text-text-secondary">无数据</span>
      )}
    </span>
  );
}
