import { ApiError, apiRequest } from './client';
import { isTCPProbeBatch, type TCPProbe, type TCPProbeBatch } from './telemetry';

export const tcpRanges = {
  '1h': { label: '1 小时', seconds: 3600, period: 60 },
  '6h': { label: '6 小时', seconds: 21600, period: 300 },
  '24h': { label: '24 小时', seconds: 86400, period: 900 },
  '7d': { label: '7 天', seconds: 604800, period: 3600 },
} as const;
export type TCPRange = keyof typeof tcpRanges;
export type TCPHistoryPoint = TCPProbeBatch & { bucket_start: number };
export type TCPHistory = {
  start: string;
  end: string;
  period_seconds: number;
  points: TCPHistoryPoint[];
};

export function parseTCPHistory(v: unknown): TCPHistory | undefined {
  if (!v || typeof v !== 'object') return;
  const h = v as TCPHistory;
  const start = Date.parse(h.start),
    end = Date.parse(h.end);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    end - start > 604800000 ||
    ![60, 300, 900, 3600].includes(h.period_seconds) ||
    !Array.isArray(h.points) ||
    h.points.length > 240
  )
    return;
  const period = h.period_seconds;
  if (Math.floor((end - 1) / (period * 1000)) - Math.floor(start / (period * 1000)) + 1 > 240)
    return;
  const seen = new Set<string>();
  for (const p of h.points) {
    if (
      !isTCPProbeBatch(p) ||
      !Number.isSafeInteger(p.bucket_start) ||
      p.bucket_start % period !== 0
    )
      return;
    const at = Date.parse(p.sampled_at);
    const key = `${p.bucket_start}`;
    if (
      at < start ||
      at >= end ||
      Math.floor(at / (period * 1000)) * period !== p.bucket_start ||
      seen.has(key)
    )
      return;
    seen.add(key);
  }
  return h;
}

export async function getTCPHistory(id: string, range: TCPRange, signal?: AbortSignal) {
  const raw = await apiRequest<unknown>(`/nodes/${encodeURIComponent(id)}/tcp-probes/history`, {
    query: { range },
    signal,
  });
  const data = parseTCPHistory(raw);
  if (!data) throw new ApiError('TCP 历史数据格式无效，请刷新重试。', 'invalid-response');
  return data;
}

export function mergeTCPHistory(
  previous: TCPHistory | undefined,
  raw: unknown,
  node: string,
  range: TCPRange,
): TCPHistory {
  const data = parseTCPHistory(raw);
  const frame = raw as { node_id?: unknown; range?: unknown; reset?: unknown; targets?: unknown };
  if (
    !data ||
    frame.node_id !== node ||
    frame.range !== range ||
    typeof frame.reset !== 'boolean' ||
    data.period_seconds !== tcpRanges[range].period ||
    !Array.isArray(frame.targets) ||
    frame.targets.length > 720 ||
    frame.targets.some((target) => typeof target !== 'string' || !target || target.length > 259) ||
    new Set(frame.targets).size !== frame.targets.length ||
    data.points.some((point) =>
      point.targets.some((probe) => !(frame.targets as string[]).includes(probe.target)),
    ) ||
    (!frame.reset && (!previous || previous.period_seconds !== data.period_seconds))
  ) {
    throw new ApiError('TCP 历史增量格式无效，请刷新历史。', 'invalid-response');
  }
  const targets = frame.targets;
  const points = new Map<string, TCPHistoryPoint>();
  const start = Date.parse(data.start),
    end = Date.parse(data.end);
  for (const point of [...(frame.reset ? [] : (previous?.points ?? [])), ...data.points]) {
    const at = Date.parse(point.sampled_at);
    if (at < start || at >= end || !point.targets.some((probe) => targets.includes(probe.target)))
      continue;
    const key = `${point.bucket_start}`;
    const old = points.get(key);
    if (!old || Date.parse(old.sampled_at) < at) points.set(key, point);
  }
  return {
    ...data,
    points: [...points.values()].sort((a, b) => a.bucket_start - b.bucket_start),
  };
}

// Use the latest actual sample in each display bucket. Never carry a sample into a gap.
export function tcpHistorySlots(
  points: TCPProbeBatch[],
  target: string,
  start: number,
  end: number,
  period: number,
) {
  const buckets = new Map<number, TCPProbe & { sampled_at: string }>();
  for (const point of [...points].sort(
    (a, b) => Date.parse(a.sampled_at) - Date.parse(b.sampled_at),
  )) {
    const at = Date.parse(point.sampled_at);
    if (at < start || at >= end) continue;
    const bucket = Math.floor(at / (period * 1000)) * period;
    const old = buckets.get(bucket);
    if (!old || Date.parse(old.sampled_at) < at) {
      const probe = point.targets.find((p) => p.target === target);
      if (probe) buckets.set(bucket, { ...probe, sampled_at: point.sampled_at });
      else buckets.delete(bucket);
    }
  }
  const slots: { start: number; point?: TCPProbe & { sampled_at: string } }[] = [];
  for (let at = Math.floor(start / (period * 1000)) * period; at * 1000 < end; at += period) {
    slots.push({ start: at, point: buckets.get(at) });
  }
  return slots;
}

// Summarize stored window snapshots; these are not individual connection attempts.
export function tcpHistorySummary(
  history: TCPHistory | undefined,
  target: string,
): TCPProbe | undefined {
  const probes = (history?.points ?? []).flatMap((point) =>
    point.targets.filter((probe) => probe.target === target),
  );
  if (!probes.length) return;
  const pings = probes
    .map((probe) => probe.ping)
    .filter((ping) => ping >= 0)
    .sort((a, b) => a - b);
  const middle = Math.floor(pings.length / 2);
  const ping = !pings.length
    ? -1
    : pings.length % 2
      ? pings[middle]
      : (pings[middle - 1] + pings[middle]) / 2;
  return {
    target,
    ping,
    loss: probes.reduce((sum, probe) => sum + probe.loss, 0) / probes.length,
  };
}

// Summarize available snapshots within each completed, fixed UTC interval.
export function tcpHistoryBlocks(
  history: TCPHistory | undefined,
  target: string,
  range: TCPRange,
  now: number,
) {
  if (!history) return [];
  const { seconds, period } = tcpRanges[range];
  const width = Math.ceil(seconds / period / 20) * period;
  const end = Math.floor(Math.min(now, Date.parse(history.end)) / (width * 1000)) * width;
  const start =
    Math.ceil(Math.max(end - seconds, Date.parse(history.start) / 1000) / width) * width;
  const blocks: { start: number; end: number; point?: TCPProbe }[] = [];
  for (let at = start; at < end; at += width) {
    const points = history.points.filter((batch) => {
      const sampled = Date.parse(batch.sampled_at) / 1000;
      return sampled >= at && sampled < at + width;
    });
    blocks.push({
      start: at,
      end: at + width,
      point: tcpHistorySummary({ ...history, points }, target),
    });
  }
  return blocks;
}
