import { Check, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { TelemetrySettings as Settings } from '@/api/telemetry';
import { Button } from '@/components/arc/button/button';
import { Input } from '@/components/arc/input/input';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import type { TCPProbeRow } from '@/components/tcp-probe-fields';

export type MonitoringFormValues = {
  tcp_global: boolean;
  tcp_targets: TCPProbeRow[];
  collection_seconds: string;
  http_report_seconds: string;
  wss_report_seconds: string;
};

export const timingFields = [
  {
    key: 'collection_seconds',
    label: '常规采集间隔',
    min: 1,
    max: 60,
    unit: '秒',
    description: '1 到 60 秒，默认 30 秒。',
  },
  {
    key: 'http_report_seconds',
    label: 'HTTP 上报间隔',
    min: 30,
    max: 180,
    unit: '秒',
    description: '30 到 180 秒，默认 60 秒。',
  },
  {
    key: 'wss_report_seconds',
    label: 'WSS 实时上报间隔',
    min: 1,
    max: 5,
    unit: '秒',
    description: '1 到 5 秒，默认 2 秒。',
  },
] as const;

const timingPresets = [
  {
    id: 'balanced',
    name: '标准平衡',
    desc: '常规运行推荐',
    collection: 30,
    http: 60,
    wss: 2,
  },
  {
    id: 'realtime',
    name: '实时高频',
    desc: '排查抖动时使用',
    collection: 10,
    http: 30,
    wss: 1,
  },
  {
    id: 'light',
    name: '轻量节流',
    desc: '低配节点省资源',
    collection: 60,
    http: 180,
    wss: 5,
  },
] as const;

export default function NodeMonitoringSettings({
  values,
  desired,
  admin,
  disabled,
  onChange,
}: {
  values: MonitoringFormValues;
  desired?: Settings;
  admin: boolean;
  disabled: boolean;
  onChange: (patch: Partial<MonitoringFormValues>) => void;
}) {
  const filledCount = values.tcp_targets.filter(
    (row) => row.name.trim() || row.target.trim(),
  ).length;
  const [visibleCount, setVisibleCount] = useState(() => Math.max(1, filledCount));

  useEffect(() => {
    setVisibleCount((prev) => Math.max(prev, filledCount, 1));
  }, [filledCount]);

  const activePreset =
    timingPresets.find(
      (preset) =>
        String(preset.collection) === values.collection_seconds &&
        String(preset.http) === values.http_report_seconds &&
        String(preset.wss) === values.wss_report_seconds,
    )?.id ?? 'custom';

  const switchingToGlobal =
    values.tcp_global && desired && !(desired.tcp_probe?.use_global ?? true);
  const inheritedTargets = values.tcp_targets
    .map((row) => ({ name: row.name.trim(), target: row.target.trim() }))
    .filter((row) => row.target);

  const visibleIndices = [0, 1, 2].filter(
    (index) =>
      index < visibleCount ||
      Boolean(values.tcp_targets[index]?.name || values.tcp_targets[index]?.target),
  );
  const canAddRow = visibleIndices.length < 3;

  function updateRow(index: number, patch: Partial<TCPProbeRow>) {
    const next = values.tcp_targets.map((row, i) => (i === index ? { ...row, ...patch } : row));
    onChange({ tcp_targets: next });
  }

  function clearRow(index: number) {
    const remaining = values.tcp_targets
      .map((row, i) => (i === index ? { name: '', target: '' } : row))
      .filter((row) => row.name || row.target);
    const compacted: TCPProbeRow[] = [0, 1, 2].map((i) => remaining[i] ?? { name: '', target: '' });
    onChange({ tcp_targets: compacted });
    setVisibleCount(Math.max(1, remaining.length));
  }

  return (
    <div className="space-y-6">
      {/* 1. Sampling & Reporting Timing */}
      <section aria-labelledby="monitoring-timing-heading" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id="monitoring-timing-heading"
            className="text-(length:--text-base) font-medium text-foreground"
          >
            采集与上报频率
          </h2>
          {activePreset === 'custom' && desired && (
            <span className="text-(length:--text-xs) text-text-secondary">当前为自定义参数</span>
          )}
        </div>

        <div className="divide-y-[1px] divide-border rounded-(--radius-surface) border-[1px] border-border bg-surface">
          {admin && (
            <div className="space-y-2.5 p-4 sm:px-5">
              <div className="text-(length:--text-xs) font-medium text-text-secondary">
                快速预设
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                {timingPresets.map((preset) => {
                  const selected = activePreset === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      disabled={disabled}
                      aria-pressed={selected}
                      onClick={() =>
                        onChange({
                          collection_seconds: String(preset.collection),
                          http_report_seconds: String(preset.http),
                          wss_report_seconds: String(preset.wss),
                        })
                      }
                      className={`rounded-(--radius-control) border-[1px] px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        selected
                          ? 'border-accent bg-(--nav-selected)'
                          : 'border-border bg-surface hover:bg-surface-muted'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-(length:--text-sm) font-medium text-foreground">
                          {preset.name}
                        </span>
                        {selected && <Check size={14} className="text-accent" aria-hidden="true" />}
                      </div>
                      <div className="mt-0.5 text-(length:--text-xs) text-text-secondary tabular-nums">
                        {preset.collection}s / {preset.http}s / {preset.wss}s
                      </div>
                      <div className="mt-0.5 text-(length:--text-xs) text-text-muted">
                        {preset.desc}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <fieldset
            disabled={disabled}
            className="grid min-w-0 grid-cols-1 gap-4 p-4 sm:grid-cols-3 sm:px-5"
          >
            {timingFields.map((field) => (
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
                onChange={(event) => onChange({ [field.key]: event.target.value })}
              />
            ))}
          </fieldset>
        </div>
      </section>

      {/* 2. TCP Probe Targets */}
      <section aria-labelledby="tcp-probe-heading" className="space-y-3">
        <h2
          id="tcp-probe-heading"
          className="text-(length:--text-base) font-medium text-foreground"
        >
          TCP 延迟探测
        </h2>

        <div className="divide-y-[1px] divide-border rounded-(--radius-surface) border-[1px] border-border bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 sm:px-5">
            <div className="min-w-0 space-y-0.5">
              <div className="text-(length:--text-sm) font-medium text-foreground">
                目标配置来源
              </div>
              <p className="text-(length:--text-xs) text-text-secondary">
                {values.tcp_global
                  ? '随系统设置中的全局探测目标自动同步。'
                  : '最多 3 个公网 host:port，全部留空即关闭本节点探测。'}
              </p>
            </div>
            <fieldset disabled={disabled}>
              <SegmentedControl
                label="目标配置来源"
                options={[
                  { value: 'global', label: '使用全局配置' },
                  { value: 'node', label: '节点独立配置' },
                ]}
                value={values.tcp_global ? 'global' : 'node'}
                onValueChange={(value) => {
                  if (!disabled) onChange({ tcp_global: value === 'global' });
                }}
              />
            </fieldset>
          </div>

          {values.tcp_global ? (
            <div className="space-y-2.5 p-4 sm:px-5">
              {switchingToGlobal ? (
                <p className="text-(length:--text-xs) text-text-secondary">
                  保存后将自动同步系统设置中的最新全局名称和目标。
                </p>
              ) : inheritedTargets.length > 0 ? (
                <>
                  <div className="flex items-center justify-between gap-2 text-(length:--text-xs) text-text-secondary">
                    <span className="font-medium tabular-nums">
                      当前继承的全局目标（{inheritedTargets.length}）
                    </span>
                    <span className="text-text-muted">只读继承</span>
                  </div>
                  <div className="divide-y-[1px] divide-border rounded-(--radius-control) border-[1px] border-border bg-surface-muted">
                    {inheritedTargets.map((item, idx) => (
                      <div
                        key={`${item.name}:${item.target}`}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-(length:--text-xs)"
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="text-text-muted tabular-nums">{idx + 1}</span>
                          <span className="truncate font-medium text-foreground">
                            {item.name || `目标 ${idx + 1}`}
                          </span>
                        </div>
                        <span className="wrap-anywhere font-mono text-text-secondary tabular-nums">
                          {item.target}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-(length:--text-xs) text-text-secondary">
                  {desired
                    ? '当前全局探测目标为空，可在系统设置中统一配置。'
                    : '尚未读取探测目标配置。'}
                </p>
              )}
            </div>
          ) : (
            <fieldset disabled={disabled} className="min-w-0 space-y-3 p-4 sm:px-5">
              <div className="space-y-3">
                {visibleIndices.map((index) => {
                  const row = values.tcp_targets[index] ?? { name: '', target: '' };
                  return (
                    <div
                      key={index}
                      className="grid min-w-0 grid-cols-1 items-start gap-2.5 sm:grid-cols-[1.5rem_minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-center"
                    >
                      <span className="hidden text-(length:--text-xs) font-medium text-text-muted tabular-nums sm:inline">
                        #{index + 1}
                      </span>
                      <Input
                        label={`TCP ${index + 1} 名称`}
                        hideLabel
                        value={row.name}
                        maxLength={64}
                        placeholder="名称（可选，如香港出口）"
                        onChange={(event) => updateRow(index, { name: event.target.value })}
                      />
                      <Input
                        label={`TCP ${index + 1} 目标`}
                        hideLabel
                        value={row.target}
                        maxLength={259}
                        placeholder="example.com:443"
                        onChange={(event) => updateRow(index, { target: event.target.value })}
                      />
                      {admin && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={
                            disabled || (!row.name && !row.target && visibleIndices.length === 1)
                          }
                          aria-label={`清空探测目标 ${index + 1}`}
                          onClick={() => clearRow(index)}
                        >
                          <X size={14} aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
              {admin && canAddRow && (
                <div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={disabled}
                    onClick={() => setVisibleCount((count) => Math.min(3, count + 1))}
                  >
                    <Plus size={14} aria-hidden="true" />
                    添加探测目标
                  </Button>
                </div>
              )}
            </fieldset>
          )}
        </div>
      </section>
    </div>
  );
}
