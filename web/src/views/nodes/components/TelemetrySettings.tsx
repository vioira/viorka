import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import { ApiError } from '@/api/client';
import type { NodeRecord } from '@/api/nodes';
import type { TelemetrySettings as Settings, TelemetryFast } from '@/api/telemetry';
import {
  getTelemetrySettings,
  saveTelemetrySettings,
  type TelemetrySettingsStatus,
  telemetrySettingsState,
} from '@/api/telemetry-settings';
import { Button } from '@/components/arc/button/button';
import { Input } from '@/components/arc/input/input';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { useRealtimeConnection, useServerEvent } from '@/hooks/realtime';
import NodeDangerZone from './NodeDangerZone';
import TrafficCalibration from './TrafficCalibration';
import TrafficSettingsFields, {
  type TrafficValues,
  trafficSettings,
  trafficValues,
} from './TrafficSettingsFields';

type Values = {
  tcp_global: boolean;
  tcp_targets: string;
  log_level: NonNullable<Settings['log_level']>;
  collection_seconds: string;
  http_report_seconds: string;
  wss_report_seconds: string;
};

const fields = [
  {
    key: 'collection_seconds',
    label: '常规采集间隔',
    min: 1,
    max: 60,
    unit: '秒',
    description: '1–60 秒，默认 30 秒。用于定期采样系统核心指标。',
  },
  {
    key: 'http_report_seconds',
    label: 'HTTP 上报间隔',
    min: 30,
    max: 180,
    unit: '秒',
    description: '30–180 秒，默认 60 秒。批量压缩历史样本上报。',
  },
  {
    key: 'wss_report_seconds',
    label: 'WSS 实时上报间隔',
    min: 1,
    max: 5,
    unit: '秒',
    description: '1–5 秒，默认 2 秒。在控制台打开监控时的高频推送。',
  },
] as const;

const valuesOf = (s: Settings): Values => ({
  tcp_global: s.tcp_probe?.use_global ?? true,
  tcp_targets: (s.tcp_probe?.targets ?? []).join(', '),
  log_level: s.log_level ?? 'warn',
  collection_seconds: String(s.collection_seconds),
  http_report_seconds: String(s.http_report_seconds),
  wss_report_seconds: String(s.wss_report_seconds),
});

const logLevelOptions = [
  { value: 'warn', label: 'WARN (推荐)' },
  { value: 'info', label: 'INFO' },
  { value: 'debug', label: 'DEBUG' },
  { value: 'error', label: 'ERROR' },
];

const logLevelHints: Record<string, string> = {
  warn: '默认推荐级别。仅记录警告与错误，性能开销极低。',
  info: '记录连接建立、会话状态与配置应用过程。',
  debug: '记录所有网络帧、指标上报与调试细节，排障后建议切回 WARN。',
  error: '仅记录致命错误，不记录常规警告与重试。',
};

export default function TelemetrySettings({
  id,
  active = true,
  node,
  traffic,
  applied,
  negotiated,
  onChanged,
}: {
  id: string;
  active?: boolean;
  node?: NodeRecord | null;
  traffic?: TelemetryFast['traffic'];
  applied?: Settings;
  negotiated: boolean;
  onChanged?: () => Promise<void>;
}) {
  const session = useOutletContext<Session>();
  const { initialized, enabled, generation: connectionGeneration } = useRealtimeConnection();
  const admin = session.user.role === 'admin';
  const { toast, dismiss } = useToastStack();

  const [flow, setFlow] = useState<TrafficValues>({
    interfaces: '',
    day: '',
    time: '',
    timezone: '',
    quota: '',
    billing: 'both',
  });
  const [desired, setDesired] = useState<Settings>();
  const [status, setStatus] = useState<TelemetrySettingsStatus>();
  const [values, setValues] = useState<Values>({
    tcp_global: true,
    tcp_targets: '',
    collection_seconds: '',
    http_report_seconds: '',
    wss_report_seconds: '',
    log_level: 'warn',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const request = useRef<AbortController | null>(null);
  const write = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const dirtyRef = useRef(false);
  const pending = useRef<Promise<void> | null>(null);
  const invalidated = useRef(false);
  const changedRevision = useRef(0);
  const desiredRef = useRef<Settings | undefined>(undefined);

  const dirty =
    desired &&
    (values.tcp_global !== valuesOf(desired).tcp_global ||
      values.tcp_targets !== valuesOf(desired).tcp_targets ||
      JSON.stringify(flow) !== JSON.stringify(trafficValues(desired.traffic)) ||
      values.log_level !== (desired.log_level ?? 'warn') ||
      fields.some((f) => values[f.key] !== String(desired[f.key])));

  dirtyRef.current = !!dirty;
  desiredRef.current = desired;

  const load = useCallback(
    (replace: boolean, force = false): Promise<void> => {
      if (pending.current) {
        invalidated.current = true;
        return pending.current;
      }
      const controller = new AbortController();
      request.current = controller;
      const current = ++generation.current;
      if (replace) setLoading(true);
      const work = (async () => {
        try {
          do {
            invalidated.current = false;
            const { desired: next, status: confirmation } = await getTelemetrySettings(
              id,
              controller.signal,
            );
            if (controller.signal.aborted || current !== generation.current) return;
            if (replace && (force || !dirtyRef.current)) {
              setDesired(next);
              setValues(valuesOf(next));
              setFlow(trafficValues(next.traffic));
            }
            setStatus(confirmation);
            dismiss(`telemetry-read-${id}`);
          } while (invalidated.current && !controller.signal.aborted);
        } catch (error) {
          if (!controller.signal.aborted && current === generation.current) {
            setStatus(undefined);
            toast({
              id: `telemetry-read-${id}`,
              type: 'error',
              title: '读取监控设置失败',
              description: error instanceof Error ? error.message : '请重新读取。',
            });
          }
        } finally {
          if (current === generation.current) {
            setLoading(false);
            pending.current = null;
          }
        }
      })();
      pending.current = work;
      return work;
    },
    [id, toast, dismiss],
  );

  useEffect(() => {
    if (!active || !initialized) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!enabled || connectionGeneration > 0) void load(true);
    else timer = setTimeout(() => void load(true), 3000);
    return () => {
      clearTimeout(timer);
      ++generation.current;
      request.current?.abort();
      pending.current = null;
    };
  }, [load, active, initialized, enabled, connectionGeneration]);
  useEffect(() => () => write.current?.abort(), []);

  useServerEvent(
    (event) => {
      if (
        !active ||
        event.type !== 'change' ||
        event.change.node_id !== id ||
        !['telemetry_settings', 'telemetry_settings_result'].includes(event.change.kind)
      )
        return;
      if (event.change.kind === 'telemetry_settings' && event.change.revision) {
        if (event.change.revision <= (desiredRef.current?.revision ?? 0)) return;
        changedRevision.current = Math.max(changedRevision.current, event.change.revision);
        if (busy.current) return;
      }
      if (busy.current) {
        invalidated.current = true;
        return;
      }
      const pushed = event.change.telemetry_settings;
      if (pushed) {
        setStatus(pushed.status);
        if (!dirtyRef.current && event.change.kind === 'telemetry_settings') {
          setDesired(pushed.desired);
          setValues(valuesOf(pushed.desired));
          setFlow(trafficValues(pushed.desired.traffic));
        } else if (dirtyRef.current && event.change.kind === 'telemetry_settings') {
          toast({
            id: `telemetry-changed-${id}`,
            type: 'info',
            title: '请核对最新监控设置',
            description: '当前输入已保留，重新读取会载入服务端设置。',
          });
        }
        return;
      }
      if (event.change.kind === 'telemetry_settings_result') {
        void load(false);
        return;
      }
      if (dirty)
        toast({
          id: `telemetry-changed-${id}`,
          type: 'info',
          title: '请核对最新监控设置',
          description: '当前输入已保留，重新读取会载入服务端设置。',
        });
      void load(true);
    },
    active
      ? [
          { kind: 'telemetry_settings', node_id: id },
          { kind: 'telemetry_settings_result', node_id: id },
        ]
      : [],
  );

  async function save() {
    if (!desired || !admin || busy.current || loading) return;
    const next: Settings = {
      ...desired,
      tcp_probe: {
        use_global: values.tcp_global,
        targets: values.tcp_global
          ? []
          : values.tcp_targets
              .split(/[,，]/)
              .map((target) => target.trim())
              .filter(Boolean),
      },
      log_level: values.log_level,
      collection_seconds: Number(values.collection_seconds),
      http_report_seconds: Number(values.http_report_seconds),
      wss_report_seconds: Number(values.wss_report_seconds),
    };
    if (
      fields.some(
        (f) =>
          !/^\d+$/.test(values[f.key]) ||
          !Number.isInteger(next[f.key]) ||
          next[f.key] < f.min ||
          next[f.key] > f.max,
      )
    ) {
      toast({
        type: 'error',
        title: '请检查监控间隔',
        description: '采集须为 1–60 秒，HTTP 为 30–180 秒，WSS 为 1–5 秒的整数。',
      });
      return;
    }
    try {
      next.traffic = trafficSettings(flow, desired.traffic);
    } catch (error) {
      toast({
        id: `traffic-validation-${id}`,
        type: 'error',
        title: '请检查流量设置',
        description: error instanceof Error ? error.message : '请核对输入。',
      });
      return;
    }
    if ((next.tcp_probe?.targets.length ?? 0) > 3) {
      toast({ type: 'error', title: '最多填写 3 个 TCP 探测目标' });
      return;
    }
    busy.current = true;
    setSaving(true);
    request.current?.abort();
    pending.current = null;
    ++generation.current;
    const controller = new AbortController();
    write.current = controller;
    try {
      const saved = await saveTelemetrySettings(session, id, next, controller.signal);
      if (controller.signal.aborted) return;
      desiredRef.current = saved;
      setDesired(saved);
      setValues(valuesOf(saved));
      setFlow(trafficValues(saved.traffic));
      setStatus({ state: 'pending' });
      toast({
        type: 'success',
        title: '监控期望配置已保存',
        description: '等待 Agent 确认，保存成功不代表已经应用。',
      });
    } catch (error) {
      if (!controller.signal.aborted)
        toast({
          type: 'error',
          title: '保存监控设置失败',
          description:
            error instanceof ApiError && error.status === 409
              ? '配置已被其他操作修改，输入已保留。请重新读取后核对再保存。'
              : error instanceof Error
                ? error.message
                : '请重试。',
        });
    } finally {
      busy.current = false;
      if (!controller.signal.aborted) {
        setSaving(false);
        if (changedRevision.current > (desiredRef.current?.revision ?? 0)) void load(true);
        else if (invalidated.current) void load(false);
      }
    }
  }

  const discard = () => {
    if (!desired) return;
    setValues(valuesOf(desired));
    setFlow(trafficValues(desired.traffic));
    toast({
      type: 'info',
      title: '已放弃更改',
      description: '表单已还原为上次加载的值。',
    });
  };

  const applyPreset = (collection: number, http: number, wss: number) => {
    setValues((old) => ({
      ...old,
      collection_seconds: String(collection),
      http_report_seconds: String(http),
      wss_report_seconds: String(wss),
    }));
  };

  const state = telemetrySettingsState(desired, status);

  return (
    <div className="space-y-6">
      {/* 0. Sync Status & Revision Indicator */}
      <section
        aria-label="同步状态与版本"
        className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-surface-raised p-4"
      >
        <div className="flex items-center gap-3">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              state === 'applied'
                ? 'bg-success'
                : state === 'pending'
                  ? 'bg-warning'
                  : state === 'failed'
                    ? 'bg-danger'
                    : 'bg-text-secondary'
            }`}
          />
          <div className="space-y-0.5">
            <div className="text-(length:--text-sm) font-medium text-foreground">
              {state === 'applied'
                ? '配置已生效并与 Agent 保持同步'
                : state === 'pending'
                  ? '等待 Agent 确认应用 (已提交期望配置)'
                  : state === 'failed'
                    ? 'Agent 应用配置失败'
                    : '配置状态尚未确认'}
            </div>
            <div className="font-mono text-(length:--text-xs) text-text-secondary tabular-nums">
              期望版本: Rev {desired?.revision ?? '--'} / 运行版本: Rev {applied?.revision ?? '--'}{' '}
              / 协议: {negotiated ? 'v3 Telemetry' : '待协商'} / 通道: HTTP / WSS
            </div>
            {state === 'failed' && (
              <p className="text-(length:--text-xs) text-danger pt-1">
                {status?.result?.error_code === 'persist_failed'
                  ? '提示：请检查节点状态目录权限和磁盘空间。'
                  : '请核对 TCP 公网目标、网卡名称及 Agent 版本是否支持面板下发目标。'}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={loading || saving}
            onClick={() => void load(true, true)}
          >
            重新读取设置
          </Button>
        </div>
      </section>

      {/* Main Settings Form */}
      <form
        noValidate
        aria-busy={loading || saving}
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {/* 1. Ingress & Telemetry Timing Policy */}
        <section aria-label="监控采集与上报策略" className="v-card space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2 border-b-[1px] border-border pb-3">
            <div>
              <h2 className="v-card-title">监控采集与上报策略</h2>
              <p className="v-card-description">
                配置 Agent 系统指标采样周期与通道上报间隔。
                {!admin && '（当前账号为查看者，仅支持只读）'}
              </p>
            </div>
            {admin && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-(length:--text-xs) text-text-secondary font-medium">
                  推荐预设：
                </span>
                <button
                  type="button"
                  disabled={loading || saving}
                  className="rounded-xs border border-border bg-surface px-2 py-0.5 text-(length:--text-xs) text-foreground hover:border-foreground/30 transition-colors cursor-pointer disabled:opacity-50"
                  onClick={() => applyPreset(30, 60, 2)}
                >
                  标准平衡 (30s / 60s / 2s)
                </button>
                <button
                  type="button"
                  disabled={loading || saving}
                  className="rounded-xs border border-border bg-surface px-2 py-0.5 text-(length:--text-xs) text-foreground hover:border-foreground/30 transition-colors cursor-pointer disabled:opacity-50"
                  onClick={() => applyPreset(10, 30, 1)}
                >
                  实时高频 (10s / 30s / 1s)
                </button>
                <button
                  type="button"
                  disabled={loading || saving}
                  className="rounded-xs border border-border bg-surface px-2 py-0.5 text-(length:--text-xs) text-foreground hover:border-foreground/30 transition-colors cursor-pointer disabled:opacity-50"
                  onClick={() => applyPreset(60, 180, 5)}
                >
                  轻量节流 (60s / 180s / 5s)
                </button>
              </div>
            )}
          </div>

          <fieldset
            disabled={!admin || !desired || loading || saving}
            className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3"
          >
            {fields.map((field) => (
              <Input
                key={field.key}
                label={`${field.label}（${field.unit}）`}
                type="number"
                min={field.min}
                max={field.max}
                step={1}
                required
                value={values[field.key]}
                placeholder="尚未读取"
                description={field.description}
                onChange={(event) =>
                  setValues((old) => ({ ...old, [field.key]: event.target.value }))
                }
              />
            ))}
          </fieldset>
        </section>

        <section aria-label="TCP 探测目标" className="v-card space-y-4">
          <h2 className="v-card-title">TCP 探测目标</h2>
          <fieldset disabled={!admin || !desired || loading || saving}>
            <SegmentedControl
              label="目标配置来源"
              options={[
                { value: 'global', label: '使用全局配置' },
                { value: 'node', label: '节点独立配置' },
              ]}
              value={values.tcp_global ? 'global' : 'node'}
              onValueChange={(value) =>
                setValues((old) => ({ ...old, tcp_global: value === 'global' }))
              }
            />
          </fieldset>
          <Input
            label={values.tcp_global ? '全局目标' : '节点独立目标'}
            value={
              values.tcp_global && desired && !valuesOf(desired).tcp_global
                ? ''
                : values.tcp_targets
            }
            disabled={!admin || !desired || loading || saving || values.tcp_global}
            placeholder={
              loading
                ? '尚未读取'
                : values.tcp_global && desired && !valuesOf(desired).tcp_global
                  ? '保存后使用最新全局目标'
                  : '未设置目标'
            }
            description={
              values.tcp_global
                ? '随系统设置中的全局目标更新。'
                : '最多 3 个公网 host:port，以逗号分隔。留空关闭本节点探测。'
            }
            onChange={(event) => setValues((old) => ({ ...old, tcp_targets: event.target.value }))}
          />
        </section>

        {/* 2. Logging & Diagnostics */}
        <section aria-label="节点日志等级" className="v-card space-y-4">
          <div className="border-b-[1px] border-border pb-3">
            <h2 className="v-card-title">节点运行日志等级</h2>
            <p className="v-card-description">
              调节 Agent 本地运行日志详细程度。调试排查完毕后建议切回 WARN 减少磁盘写入。
            </p>
          </div>

          <div className="max-w-md space-y-2">
            <SegmentedControl
              options={logLevelOptions}
              value={values.log_level}
              onValueChange={(val) =>
                setValues((old) => ({ ...old, log_level: val as Values['log_level'] }))
              }
            />
            <p className="text-(length:--text-xs) text-text-secondary">
              {logLevelHints[values.log_level] ?? ''}
            </p>
          </div>
        </section>

        {/* 3. Traffic Accounting & Quota */}
        <section id="traffic-settings" aria-label="流量统计与账期配额" className="v-card space-y-4">
          <div className="border-b-[1px] border-border pb-3">
            <h2 className="v-card-title">流量统计与账期配额</h2>
            <p className="v-card-description">
              设定流量重置账期与统计网卡，配置周期配额与计费方向。
            </p>
          </div>

          <TrafficSettingsFields
            values={flow}
            onChange={setFlow}
            traffic={traffic}
            disabled={!admin || !desired || loading || saving}
          />
        </section>

        {/* Normal Form Footer Actions */}
      </form>

      {/* 4. Traffic Calibration Section */}
      <TrafficCalibration id={id} traffic={traffic} enabled={admin && negotiated} />

      {/* 5. Danger Zone */}
      {node && <NodeDangerZone node={node} session={session} onChanged={onChanged} />}

      {/* 6. Sticky Dirty Save Bar */}
      {active && dirty && admin && (
        <aside
          aria-label="未保存设置提示"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center justify-between gap-4 w-[calc(100%-2rem)] max-w-2xl rounded-xl border border-border bg-surface-raised p-4 shadow-lg"
        >
          <div className="flex items-center gap-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-warning shadow-sm" />
            <span className="text-(length:--text-sm) font-medium text-foreground">
              检测到未保存的设置更改
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <Button
              type="button"
              variant="secondary"
              disabled={loading || saving}
              onClick={discard}
            >
              放弃更改
            </Button>
            <Button
              type="button"
              loading={saving}
              disabled={loading || saving}
              onClick={() => void save()}
            >
              保存监控设置
            </Button>
          </div>
        </aside>
      )}
    </div>
  );
}
