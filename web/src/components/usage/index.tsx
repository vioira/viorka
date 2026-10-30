interface UsageProps {
  value: number | null;
  /** Visible on compact table rows; still available to screen readers on desktop. */
  label?: string;
}

/** Compact percentage readout; the bar is decorative, the text keeps the measured value. */
export default function Usage({ value, label }: UsageProps) {
  const known = value !== null && Number.isFinite(value) && value >= 0;
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap tabular-nums">
      {label && <span className="min-[621px]:sr-only">{label}</span>}
      {known ? (
        <>
          <span
            aria-hidden="true"
            className="inline-block h-[5px] w-[76px] shrink-0 overflow-hidden rounded-full bg-(--usage-track)"
          >
            <span
              className="block h-full rounded-full bg-(image:--usage-fill)"
              style={{ width: `${Math.min(value, 100)}%` }}
            />
          </span>
          <span className="min-w-9">{value}%</span>
        </>
      ) : (
        <span className="text-text-secondary">无数据</span>
      )}
    </span>
  );
}
