import type { ProbeLine, ProbePoint } from '@/api/public-status';

export const statusProbePeriod = 180;

export function statusProbeSlots(line: ProbeLine, snapshotAt: number) {
  const end = Math.floor(snapshotAt / (statusProbePeriod * 1000)) * statusProbePeriod;
  const latestBySlot = new Map<number, ProbePoint>();
  for (const point of [...line.history, ...(line.latest ? [line.latest] : [])]) {
    const at = Date.parse(point.at);
    const start = Math.floor(at / (statusProbePeriod * 1000)) * statusProbePeriod;
    const previous = latestBySlot.get(start);
    if (!previous || at > Date.parse(previous.at)) latestBySlot.set(start, point);
  }
  return Array.from({ length: 3600 / statusProbePeriod }, (_, i) => {
    const start = end - 3600 + i * statusProbePeriod;
    return { start, end: start + statusProbePeriod, point: latestBySlot.get(start) };
  });
}
