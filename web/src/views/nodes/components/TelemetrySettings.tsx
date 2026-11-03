import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import { ApiError } from '@/api/client';
import type { TelemetrySettings as Settings, TelemetryFast } from '@/api/telemetry';
import {
  getTelemetrySettings,
  getTelemetrySettingsStatus,
  saveTelemetrySettings,
  type TelemetrySettingsStatus,
  telemetrySettingsState,
} from '@/api/telemetry-settings';
import { Button } from '@/components/arc/button/button';
import { Input } from '@/components/arc/input/input';
import { RadioGroup } from '@/components/arc/radio-group/radio-group';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { useServerEvent } from '@/hooks/realtime';
import TrafficCalibration from './TrafficCalibration';
import TrafficSettingsFields, {
  type TrafficValues,
  trafficSettings,
  trafficValues,
} from './TrafficSettingsFields';

type Values = {
  log_level: NonNullable<Settings['log_level']>;
  collection_seconds: string;
  http_report_seconds: string;
  wss_report_seconds: string;
};
const fields = [
  {
    key: 'collection_seconds',
    label: '常规采集间隔（秒）',
    min: 1,
    max: 60,
    description: '1–60 秒，默认 30 秒。实时需求有效时使用实时采集周期。',
  },
  {
    key: 'http_report_seconds',
    label: 'HTTP 上报间隔（秒）',
    min: 30,
    max: 180,
    description: '30–180 秒，默认 60 秒。批量发送缓存样本，允许短于采集间隔。',
  },
  {
    key: 'wss_report_seconds',
    label: 'WSS 实时上报间隔（秒）',
    min: 1,
    max: 5,
    description: '1–5 秒，默认 2 秒。有实时查看需求且 Agent 确认后启用。',
  },
] as const;
const valuesOf = (s: Settings): Values => ({
  log_level: s.log_level ?? 'warn',
  collection_seconds: String(s.collection_seconds),
  http_report_seconds: String(s.http_report_seconds),
  wss_report_seconds: String(s.wss_report_seconds),
});
export default function TelemetrySettings({
  id,
  traffic,
  applied,
  negotiated,
}: {
  id: string;
  traffic?: TelemetryFast['traffic'];
  applied?: Settings;
  negotiated: boolean;
}) {
  const session = useOutletContext<Session>();
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
  const dirty =
    desired &&
    (JSON.stringify(flow) !== JSON.stringify(trafficValues(desired.traffic)) ||
      values.log_level !== (desired.log_level ?? 'warn') ||
      fields.some((f) => values[f.key] !== String(desired[f.key])));
  const load = useCallback(
    async (replace: boolean) => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      const current = ++generation.current;
      if (replace) setLoading(true);
      try {
        const [next, confirmation] = await Promise.all([
          replace ? getTelemetrySettings(id, controller.signal) : Promise.resolve(undefined),
          getTelemetrySettingsStatus(id, controller.signal),
        ]);
        if (controller.signal.aborted || current !== generation.current) return;
        if (next) {
          setDesired(next);
          setValues(valuesOf(next));
          setFlow(trafficValues(next.traffic));
        }
        setStatus(confirmation);
        dismiss(`telemetry-read-${id}`);
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
        if (!controller.signal.aborted && current === generation.current) setLoading(false);
      }
    },
    [id, toast, dismiss],
  );
  useEffect(() => {
    void load(true);
    return () => {
      ++generation.current;
      request.current?.abort();
      write.current?.abort();
    };
  }, [load]);
  useServerEvent((event) => {
    if (busy.current || loading) return;
    if (
      event.type === 'change' &&
      event.change.node_id === id &&
      event.change.kind === 'telemetry_settings_result'
    ) {
      void load(false);
      return;
    }
    if (
      event.type !== 'ready' &&
      !(
        event.type === 'change' &&
        event.change.node_id === id &&
        event.change.kind === 'telemetry_settings'
      )
    )
      return;
    if (dirty) {
      toast({
        id: `telemetry-changed-${id}`,
        type: 'info',
        title: '请核对最新监控设置',
        description: '当前输入已保留，重新读取会载入服务端设置。',
      });
      void load(false);
    } else void load(true);
  });
  async function save() {
    if (!desired || !admin || busy.current || loading) return;
    const next: Settings = {
      ...desired,
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
    busy.current = true;
    setSaving(true);
    request.current?.abort();
    ++generation.current;
    const controller = new AbortController();
    write.current = controller;
    try {
      const saved = await saveTelemetrySettings(session, id, next, controller.signal);
      if (controller.signal.aborted) return;
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
        void load(false);
      }
    }
  }
  const state = telemetrySettingsState(desired, status);
  return (
    <section aria-label="新版监控设置" className="space-y-4 border-t-[0.5px] border-border pt-6">
      <h2 className="font-medium">监控与节点日志</h2>
      <p className="text-(length:--text-xs) text-text-secondary">
        连接模式：HTTP 定期上报与按需 WSS 实时上报。
        {!negotiated && '尚未确认节点支持新版监控，配置会保留等待协商。'}
        {!admin && '仅管理员可修改。'}
      </p>
      <p
        role="status"
        className="min-h-10 text-(length:--text-xs) text-text-secondary tabular-nums"
      >
        期望版本：{desired?.revision ?? '尚未读取'}。确认状态：
        {state === 'unknown'
          ? '未知，请重新读取'
          : state === 'pending'
            ? '等待 Agent 确认'
            : state === 'applied'
              ? 'Agent 已确认应用'
              : 'Agent 应用失败'}
        。
        {state === 'failed' &&
          (status?.result?.error_code === 'persist_failed'
            ? '请检查节点状态目录权限和磁盘空间。'
            : '请核对网卡是否存在、配置版本及 Agent 日志。')}
      </p>
      <p className="min-h-10 text-(length:--text-xs) text-text-secondary tabular-nums">
        最近已应用配置：
        {applied
          ? `版本 ${applied.revision}，采集 ${applied.collection_seconds} 秒，HTTP ${applied.http_report_seconds} 秒，WSS ${applied.wss_report_seconds} 秒，日志 ${applied.log_level ?? 'warn'}。`
          : '尚未取得。'}
        上报模式与数据新鲜度见指标页。
      </p>
      <form
        noValidate
        className="space-y-4"
        aria-busy={loading || saving}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset
          disabled={!admin || !desired || loading || saving}
          className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2"
        >
          {fields.map((field) => (
            <Input
              key={field.key}
              label={field.label}
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
          <RadioGroup
            label="节点日志等级"
            name="log_level"
            value={values.log_level}
            onValueChange={(value) =>
              setValues((old) => ({ ...old, log_level: value as Values['log_level'] }))
            }
            options={[
              { value: 'warn', label: 'WARN', description: '默认，仅记录警告与错误。' },
              { value: 'info', label: 'INFO', description: '包含连接和监控运行状态。' },
              { value: 'debug', label: 'DEBUG', description: '包含调试信息，用于排查问题。' },
              { value: 'error', label: 'ERROR', description: '仅记录错误。' },
            ]}
          />
          <TrafficSettingsFields values={flow} onChange={setFlow} />
        </fieldset>
        <div className="flex flex-wrap gap-2">
          {admin && (
            <Button type="submit" loading={saving} disabled={!desired || loading || saving}>
              保存监控设置
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            disabled={loading || saving}
            onClick={() => load(true)}
          >
            重新读取监控设置
          </Button>
        </div>
      </form>
      <TrafficCalibration id={id} traffic={traffic} enabled={admin && negotiated} />
    </section>
  );
}
