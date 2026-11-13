import type { EngineRecord, EngineSummary } from './engines';
import { mergeMetricTrends } from './metric-trends';
import { isMonitoringSnapshot, type MonitoringSnapshot } from './monitoring';
import { type NodeTask, parseTask } from './node-tasks';
import { type NodeRecord, parseNode } from './nodes';
import { parseTelemetrySettingsResponse } from './telemetry-settings';

export type ResourceChange = {
  kind: string;
  node_id?: string;
  node?: NodeRecord;
  task_id?: string;
  task?: NodeTask;
  engine_id?: string;
  revision?: number;
  engine?: EngineSummary;
  engine_detail?: EngineRecord;
  telemetry_settings?: ReturnType<typeof parseTelemetrySettingsResponse>;
};
export type LivePoint = {
  group?: 'fast' | 'full';
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
      'engines',
      'node',
      'nodes',
      'tasks',
      'history',
      'telemetry_settings',
      'telemetry_settings_result',
      'settings',
    ].includes(String(v.kind)) ||
    (v.revision !== undefined && !sequence(v.revision)) ||
    ['node_id', 'task_id', 'engine_id'].some(
      (key) => v[key] !== undefined && typeof v[key] !== 'string',
    )
  )
    throw new Error('实时事件格式无效，请重新连接。');
  const node = v.node === undefined ? undefined : parseNode(v.node);
  if (node && node.id !== v.node_id) throw new Error('实时节点身份不匹配，请重新连接。');
  if (
    v.engine !== undefined &&
    (!record(v.engine) ||
      v.engine.id !== v.engine_id ||
      v.engine.node_id !== v.node_id ||
      !Number.isSafeInteger(v.engine.draft_version) ||
      !Number.isSafeInteger(v.engine.service_count))
  )
    throw new Error('引擎事件格式无效');
  if (
    v.engine_detail !== undefined &&
    (!record(v.engine_detail) ||
      v.engine_detail.id !== v.engine_id ||
      v.engine_detail.node_id !== v.node_id ||
      !record(v.engine_detail.draft) ||
      !Number.isSafeInteger(v.engine_detail.draft.version))
  )
    throw new Error('引擎配置事件格式无效');
  return {
    kind: v.kind as string,
    node_id: v.node_id as string | undefined,
    node,
    task_id: v.task_id as string | undefined,
    task: v.task === undefined ? undefined : parseTask(v.task, String(v.node_id)),
    engine_id: v.engine_id as string | undefined,
    revision: v.revision as number | undefined,
    engine: v.engine as EngineSummary | undefined,
    engine_detail: v.engine_detail as EngineRecord | undefined,
    telemetry_settings:
      v.telemetry_settings === undefined
        ? undefined
        : parseTelemetrySettingsResponse(v.telemetry_settings),
  };
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
    if (
      s.telemetry &&
      (s.telemetry.sequence !== extra.sequence ||
        s.telemetry.reset !== extra.reset ||
        extra.points.length !== 0)
    )
      throw new Error('新版指标游标不一致，请重新连接。');
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
    const old = next[id] ?? current[id];
    if (old && !sample.reset && sample.sequence < old.sequence) continue;
    const metricTrends = sample.metric_trends
      ? mergeMetricTrends(
          frame.reset || sample.reset ? undefined : old?.metric_trends,
          sample.metric_trends,
        )
      : frame.reset || sample.reset
        ? undefined
        : old?.metric_trends;
    if (sample.telemetry) {
      const t = sample.telemetry;
      const previous = old?.telemetry;
      const reset = !previous || previous.run_id !== t.run_id || t.sequence < previous.sequence;
      const replaceGroups = reset || sample.reset || frame.reset;
      next[id] = {
        ...sample,
        metric_trends: metricTrends,
        telemetry: {
          ...t,
          fast: t.fast ?? (replaceGroups ? undefined : previous?.fast),
          full: t.full ?? (replaceGroups ? undefined : previous?.full),
          public_ip: t.public_ip ?? (replaceGroups ? undefined : previous?.public_ip),
          settings: t.settings ?? (replaceGroups ? undefined : previous?.settings),
          points: t.points,
        },
      };
      continue;
    }
    next[id] = {
      ...sample,
      metric_trends: metricTrends,
      points: sample.points,
    };
  }
  for (const id of frame.removed_ids) delete next[id];
  return next;
}
