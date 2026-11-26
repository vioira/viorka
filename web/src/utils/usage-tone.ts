const usageColors = [
  'var(--probe-excellent)',
  'var(--probe-good)',
  'var(--probe-moderate)',
  'var(--probe-elevated)',
  'var(--probe-critical)',
];

export function usageColor(percent: number) {
  const band = Math.floor(Math.max(0, percent) / 20);
  return usageColors[Math.min(band, usageColors.length - 1)];
}

export function interpolatedUsageColor(percent: number) {
  const position = (Math.min(100, Math.max(0, percent)) / 100) * (usageColors.length - 1);
  const lower = Math.floor(position);
  if (position === lower) return usageColors[lower];
  return `color-mix(in srgb, ${usageColors[lower]}, ${usageColors[lower + 1]} ${(position - lower) * 100}%)`;
}

export function usageTone(value: number | undefined) {
  return value === undefined
    ? 'accent'
    : value >= 95
      ? 'danger'
      : value >= 80
        ? 'warning'
        : 'success';
}
