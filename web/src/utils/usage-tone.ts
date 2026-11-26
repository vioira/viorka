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

export function usageTone(value: number | undefined) {
  return value === undefined
    ? 'accent'
    : value >= 95
      ? 'danger'
      : value >= 80
        ? 'warning'
        : 'success';
}
