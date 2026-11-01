import { isMonitoringSnapshot, type MonitoringSnapshot } from './monitoring';
import { type NodeRecord, parseNode } from './nodes';

export type ResourceChange = { kind: string; node_id?: string; node?: NodeRecord };
export type LivePoint = {
  sequence: number;
  at: string;
  received_at: string;
  values: Record<string, number>;
};
export type LiveSnapshot = MonitoringSnapshot & {
  sequence: number;
  reset: boolean;
  points: LivePoint[];
};
export type MetricFrame = {
  reset: boolean;
  items: Record<string, LiveSnapshot>;
  removed_ids: string[];
};
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const sequence = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
export function parseResourceChange(raw: string): ResourceChange {
  const v: unknown = JSON.parse(raw);
  if (
    !record(v) ||
    ![
      'node',
      'nodes',
      'tasks',
      'history',
      'node_settings',
      'node_settings_result',
      'settings',
    ].includes(String(v.kind)) ||
    (v.node_id !== undefined && typeof v.node_id !== 'string')
  )
    throw new Error('实时事件格式无效，请重新连接。');
  const node = v.node === undefined ? undefined : parseNode(v.node);
  if (node && node.id !== v.node_id) throw new Error('实时节点身份不匹配，请重新连接。');
  return { kind: v.kind as string, node_id: v.node_id as string | undefined, node };
}
export function parseMetricFrame(raw: string): MetricFrame {
  const v: unknown = JSON.parse(raw);
  if (
    !record(v) ||
    typeof v.reset !== 'boolean' ||
    !record(v.items) ||
    Object.keys(v.items).length > 1024 ||
    !Array.isArray(v.removed_ids) ||
    !v.removed_ids.every((id) => typeof id === 'string')
  )
    throw new Error('实时指标格式无效，请重新连接。');
  for (const s of Object.values(v.items)) {
    if (!record(s)) throw new Error('实时指标快照无效');
    const extra = s;
    if (
      !isMonitoringSnapshot(s) ||
      !sequence(extra.sequence) ||
      typeof extra.reset !== 'boolean' ||
      !Array.isArray(extra.points) ||
      extra.points.length > 600
    )
      throw new Error('实时指标快照无效，请重新连接。');
    let previous = 0;
    for (const p of extra.points) {
      if (
        !record(p) ||
        !sequence(p.sequence) ||
        p.sequence <= previous ||
        p.sequence > extra.sequence ||
        !date(p.at) ||
        !date(p.received_at) ||
        !record(p.values) ||
        Object.keys(p.values).length > 32 ||
        !Object.values(p.values).every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)
      )
        throw new Error('实时采样格式无效，请重新连接。');
      previous = p.sequence;
    }
  }
  return v as MetricFrame;
}
export function mergeMetricFrame(current: Record<string, LiveSnapshot>, frame: MetricFrame) {
  const next = frame.reset ? ({} as Record<string, LiveSnapshot>) : { ...current };
  for (const [id, sample] of Object.entries(frame.items)) {
    const old = next[id];
    if (old && !sample.reset && sample.sequence < old.sequence) continue;
    const points =
      sample.reset || !old
        ? sample.points
        : [...old.points, ...sample.points.filter((p) => p.sequence > old.sequence)];
    const cutoff = Date.parse(sample.received_at) - 600_000;
    next[id] = {
      ...sample,
      points: points.filter((p) => Date.parse(p.received_at) > cutoff).slice(-600),
    };
  }
  for (const id of frame.removed_ids) delete next[id];
  return next;
}
