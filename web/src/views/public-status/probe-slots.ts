import type { ProbeLine, ProbePoint } from '@/api/public-status';

export const statusProbePeriod = 180;

export function statusProbeSlots(line: ProbeLine, snapshotAt: number) {
  const end = Math.floor(snapshotAt / (statusProbePeriod * 1000)) * statusProbePeriod;
  const minutes = new Map<number, ProbePoint>();
  for (const point of [...line.history, ...(line.latest ? [line.latest] : [])]) {
    const at = Date.parse(point.at);
    const minute = Math.floor(at / 60000) * 60;
    const previous = minutes.get(minute);
    if (!previous || at > Date.parse(previous.at)) minutes.set(minute, point);
  }
  return Array.from({ length: 3600 / statusProbePeriod }, (_, i) => {
    const start = end - 3600 + i * statusProbePeriod;
    const point =
      minutes.has(start) && minutes.has(start + 60) ? minutes.get(start + 120) : undefined;
    return { start, end: start + statusProbePeriod, point };
  });
}
