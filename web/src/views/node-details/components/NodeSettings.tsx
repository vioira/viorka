import { Activity, Cpu, Gauge, RefreshCw, Save, Server, Shield, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@/api/auth';
import { ApiError } from '@/api/client';
import type { NodeBilling } from '@/api/node-billing';
import { type BillingUpdate, saveNodeSettings } from '@/api/node-settings';
import { getNode, type NodeRecord } from '@/api/nodes';
import type { TelemetrySettings as Settings, TelemetryFast } from '@/api/telemetry';
import {
  getTelemetrySettings,
  type TelemetrySettingsStatus,
  telemetrySettingsState,
} from '@/api/telemetry-settings';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { Input } from '@/components/arc/input/input';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import type { useCategoryCatalog } from '@/components/node-classification';
import { type TCPProbeRow, tcpProbeConfig, tcpProbeRows } from '@/components/tcp-probe-fields';
import { useRealtimeConnection, useServerEvent } from '@/hooks/realtime';
import NodeDangerZone from '@/views/nodes/components/NodeDangerZone';
import TrafficCalibration from '@/views/nodes/components/TrafficCalibration';
import TrafficSettingsFields, {
  type TrafficValues,
  trafficSettings,
  trafficValues,
} from '@/views/nodes/components/TrafficSettingsFields';
import { AgentUpdates } from './AgentUpdates';
import NodeBillingSettings from './NodeBillingSettings';
import NodeIdentitySettings from './NodeIdentitySettings';
import NodeMonitoringSettings, { timingFields } from './NodeMonitoringSettings';
import {
  type BillingDraft,
  billingDirty,
  billingUpdate,
  editBilling,
  rebaseBillingDraft,
} from './node-billing-draft';

export type SettingsSectionId = 'general' | 'traffic' | 'monitoring' | 'agent' | 'security';

type TelemetryFormValues = {
  tcp_global: boolean;
  tcp_targets: TCPProbeRow[];
  log_level: NonNullable<Settings['log_level']>;
  collection_seconds: string;
  http_report_seconds: string;
  wss_report_seconds: string;
};

const valuesOf = (s: Settings): TelemetryFormValues => ({
  tcp_global: s.tcp_probe?.use_global ?? true,
  tcp_targets: tcpProbeRows(s.tcp_probe?.targets, s.tcp_probe?.names),
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
  warn: '仅记录警告与错误，磁盘写入开销极低。',
  info: '记录连接建立、会话状态与配置应用过程。',
  debug: '记录全部网络帧、指标上报与调试细节，排查后建议切回 WARN。',
  error: '仅记录致命错误，不记录常规警告与重试。',
};

const primaryNavItems: {
  id: Exclude<SettingsSectionId, 'security'>;
  label: string;
  icon: typeof Server;
}[] = [
  { id: 'general', label: '常规与资产', icon: Server },
  { id: 'traffic', label: '流量与配额', icon: Gauge },
  { id: 'monitoring', label: '监控与探测', icon: Activity },
  { id: 'agent', label: 'Agent 与运行', icon: Cpu },
];

export default function NodeSettings({
  id,
  active = true,
  node,
  session,
  traffic,
  applied,
  negotiated,
  catalogState,
  onChanged,
  initialSection = 'general',
}: {
  id: string;
  active?: boolean;
  node?: NodeRecord | null;
  session: Session;
  traffic?: TelemetryFast['traffic'];
  applied?: Settings;
  negotiated: boolean;
  catalogState: ReturnType<typeof useCategoryCatalog>;
  onChanged: () => Promise<void>;
  initialSection?: SettingsSectionId;
}) {
  const { initialized, enabled, generation: connectionGeneration } = useRealtimeConnection();
  const admin = session.user.role === 'admin';
  const { toast, dismiss } = useToastStack();

  const [section, setSection] = useState<SettingsSectionId>(
    initialSection === 'security' && !admin ? 'general' : initialSection,
  );
  useEffect(() => {
    if (!admin && section === 'security') setSection('general');
  }, [admin, section]);

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
  const [values, setValues] = useState<TelemetryFormValues>({
    tcp_global: true,
    tcp_targets: tcpProbeRows(),
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

  const [domainDraft, setDomainDraft] = useState<{ value: string; expected: string }>();
  const currentDomain = node?.domain ?? '';
  const [savedBilling, setSavedBilling] = useState<NodeBilling>();
  const [billingDraft, setBillingDraft] = useState<BillingDraft>();
  const currentBilling =
    savedBilling && savedBilling.revision > (node?.billing?.revision ?? 0)
      ? savedBilling
      : node?.billing;
  const billingForm = billingDraft ?? (currentBilling && editBilling(currentBilling));
  const setBillingForm = (next: BillingDraft) =>
    setBillingDraft(billingDirty(next) ? next : undefined);

  const baseline = desired ? valuesOf(desired) : undefined;
  const trafficDirty = Boolean(
    desired && JSON.stringify(flow) !== JSON.stringify(trafficValues(desired.traffic)),
  );
  const monitoringDirty = Boolean(
    baseline &&
      (values.tcp_global !== baseline.tcp_global ||
        JSON.stringify(values.tcp_targets) !== JSON.stringify(baseline.tcp_targets) ||
        timingFields.some((f) => values[f.key] !== baseline[f.key])),
  );
  const logDirty = Boolean(baseline && values.log_level !== baseline.log_level);
  const telemetryDirty = trafficDirty || monitoringDirty || logDirty;

  const dirtySections: { id: SettingsSectionId; label: string }[] = [
    ...(domainDraft ? [{ id: 'general' as const, label: '节点域名' }] : []),
    ...(billingDraft ? [{ id: 'general' as const, label: '费用与续期' }] : []),
    ...(trafficDirty ? [{ id: 'traffic' as const, label: '流量与配额' }] : []),
    ...(monitoringDirty ? [{ id: 'monitoring' as const, label: '监控与探测' }] : []),
    ...(logDirty ? [{ id: 'agent' as const, label: '运行日志等级' }] : []),
  ];

  dirtyRef.current = telemetryDirty;
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
      if (telemetryDirty)
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

  function telemetryUpdate(currentDesired: Settings): Settings | undefined {
    let probeConfig: ReturnType<typeof tcpProbeConfig>;
    try {
      probeConfig = tcpProbeConfig(values.tcp_global ? [] : values.tcp_targets);
    } catch (error) {
      setSection('monitoring');
      toast({ type: 'error', title: (error as Error).message });
      return;
    }
    const next: Settings = {
      ...currentDesired,
      tcp_probe: {
        use_global: values.tcp_global,
        ...probeConfig,
      },
      log_level: values.log_level,
      collection_seconds: Number(values.collection_seconds),
      http_report_seconds: Number(values.http_report_seconds),
      wss_report_seconds: Number(values.wss_report_seconds),
    };
    if (
      timingFields.some(
        (f) =>
          !/^\d+$/.test(values[f.key]) ||
          !Number.isInteger(next[f.key]) ||
          next[f.key] < f.min ||
          next[f.key] > f.max,
      )
    ) {
      setSection('monitoring');
      toast({
        type: 'error',
        title: '请检查监控间隔',
        description: '采集须为 1 到 60 秒，HTTP 为 30 到 180 秒，WSS 为 1 到 5 秒的整数。',
      });
      return;
    }
    try {
      next.traffic = trafficSettings(flow, currentDesired.traffic);
    } catch (error) {
      setSection('traffic');
      toast({
        id: `traffic-validation-${id}`,
        type: 'error',
        title: '请检查流量设置',
        description: error instanceof Error ? error.message : '请核对输入。',
      });
      return;
    }
    if ((next.tcp_probe?.targets.length ?? 0) > 3) {
      setSection('monitoring');
      toast({ type: 'error', title: '最多填写 3 个 TCP 探测目标' });
      return;
    }
    return next;
  }

  async function save() {
    if (!admin || busy.current || (!domainDraft && !billingDraft && !telemetryDirty)) return;
    let billing: BillingUpdate | undefined;
    try {
      if (billingDraft) billing = billingUpdate(billingDraft);
    } catch (error) {
      setSection('general');
      toast({
        id: `billing-validation-${id}`,
        type: 'error',
        title: '请检查费用与续期',
        description: error instanceof Error ? error.message : undefined,
      });
      return;
    }
    const next = telemetryDirty && desired ? telemetryUpdate(desired) : undefined;
    if (telemetryDirty && !next) return;
    busy.current = true;
    setSaving(true);
    if (next) {
      request.current?.abort();
      pending.current = null;
      ++generation.current;
      setLoading(false);
    }
    const controller = new AbortController();
    write.current = controller;
    try {
      const result = await saveNodeSettings(
        session,
        id,
        {
          domain: domainDraft?.value.trim(),
          expected_domain: domainDraft?.expected,
          billing,
          telemetry: next,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (result.domain !== undefined) setDomainDraft(undefined);
      if (result.billing) {
        setSavedBilling(result.billing);
        setBillingDraft(undefined);
      }
      if (result.telemetry) {
        desiredRef.current = result.telemetry;
        setDesired(result.telemetry);
        setValues(valuesOf(result.telemetry));
        setFlow(trafficValues(result.telemetry.traffic));
        setStatus({ state: 'pending' });
      }
      toast({
        type: 'success',
        title: '节点设置已保存',
        description: next ? '监控配置等待 Agent 确认。' : undefined,
      });
      if (result.domain !== undefined || result.billing) await onChanged();
    } catch (error) {
      if (
        !controller.signal.aborted &&
        domainDraft &&
        error instanceof ApiError &&
        error.status === 409
      ) {
        await onChanged();
      }
      if (!controller.signal.aborted)
        toast({
          type: 'error',
          id: `settings-save-${id}`,
          title: '保存节点设置失败',
          description:
            error instanceof ApiError && error.status === 409
              ? domainDraft
                ? '配置已变更。请先放弃更改，核对最新值后重新编辑。'
                : '配置已被其他操作修改，输入已保留。请重新读取后核对再保存。'
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

  function discard() {
    setDomainDraft(undefined);
    setBillingDraft(undefined);
    if (desired) {
      setValues(valuesOf(desired));
      setFlow(trafficValues(desired.traffic));
    }
    toast({
      type: 'info',
      title: '已放弃更改',
      description: '表单已还原为上次加载的值。',
    });
  }

  async function reloadSettings() {
    if (!billingDraft) {
      await load(true, true);
      return;
    }
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    const controller = new AbortController();
    write.current = controller;
    try {
      const latest = await getNode(id, controller.signal);
      if (controller.signal.aborted) return;
      if (!latest.billing) throw new Error('尚未读取费用配置。');
      setSavedBilling(latest.billing);
      setBillingForm(rebaseBillingDraft(billingDraft, latest.billing));
      await load(true, true);
    } catch (error) {
      if (!controller.signal.aborted)
        toast({
          id: `billing-read-${id}`,
          type: 'error',
          title: '读取节点设置失败',
          description: error instanceof Error ? error.message : undefined,
        });
    } finally {
      busy.current = false;
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  const syncState = telemetrySettingsState(desired, status);
  const showSyncStrip =
    syncState === 'pending' ||
    syncState === 'failed' ||
    ['traffic', 'monitoring', 'agent'].includes(section);
  const formDisabled = !admin || !desired || loading || saving;
  const isSectionDirty = (secId: SettingsSectionId) => dirtySections.some((d) => d.id === secId);

  const mobileNavItems: { id: SettingsSectionId; label: string }[] = [
    ...primaryNavItems.map(({ id: itemId, label }) => ({ id: itemId, label })),
    ...(admin ? [{ id: 'security' as const, label: '凭据与安全' }] : []),
  ];

  const syncMeta =
    syncState === 'applied'
      ? {
          dotClass: 'bg-success',
          title: '配置已与 Agent 同步',
          badgeTone: 'success' as const,
          badgeText: `Rev ${applied?.revision ?? desired?.revision ?? '--'}`,
        }
      : syncState === 'pending'
        ? {
            dotClass: 'bg-warning',
            title: `等待 Agent 确认应用（期望 Rev ${desired?.revision ?? '--'}，运行 Rev ${applied?.revision ?? '--'}）`,
            badgeTone: 'warning' as const,
            badgeText: '同步中',
          }
        : syncState === 'failed'
          ? {
              dotClass: 'bg-danger',
              title: `Agent 应用配置失败（期望 Rev ${desired?.revision ?? '--'}，运行 Rev ${applied?.revision ?? '--'}）`,
              badgeTone: 'danger' as const,
              badgeText: '应用失败',
            }
          : {
              dotClass: 'bg-text-muted',
              title: negotiated ? '配置同步状态尚未确认' : '协议待协商，配置将在连接就绪后同步',
              badgeTone: 'neutral' as const,
              badgeText: desired ? `Rev ${desired.revision}` : '未读取',
            };

  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
      {/* Sub-navigation: Horizontal pills on mobile, Sticky vertical rail on desktop */}
      <aside aria-label="设置分类" className="min-w-0 md:sticky md:top-6">
        {/* Mobile Horizontal Pill Bar */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:hidden">
          {mobileNavItems.map((item) => {
            const selected = section === item.id;
            const dirty = isSectionDirty(item.id);
            return (
              <button
                key={item.id}
                type="button"
                aria-current={selected ? 'page' : undefined}
                onClick={() => setSection(item.id)}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-(--radius-control) border-[1px] px-3 py-1.5 text-(length:--text-xs) font-medium transition-colors ${
                  selected
                    ? 'border-accent bg-(--nav-selected) text-foreground'
                    : 'border-border bg-surface text-text-secondary hover:text-foreground'
                }`}
              >
                <span>{item.label}</span>
                {dirty && (
                  <>
                    <span className="size-1.5 rounded-full bg-warning" aria-hidden="true" />
                    <span className="sr-only">（有未保存更改）</span>
                  </>
                )}
              </button>
            );
          })}
        </div>

        {/* Desktop Vertical Navigation Rail */}
        <nav className="hidden space-y-1 md:block" aria-label="节点设置分类">
          {primaryNavItems.map((item) => {
            const Icon = item.icon;
            const selected = section === item.id;
            const dirty = isSectionDirty(item.id);
            return (
              <button
                key={item.id}
                type="button"
                aria-current={selected ? 'page' : undefined}
                onClick={() => setSection(item.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-(--radius-control) px-3 py-2 text-(length:--text-sm) transition-colors ${
                  selected
                    ? 'bg-(--nav-selected) font-medium text-foreground'
                    : 'text-text-secondary hover:bg-surface-muted hover:text-foreground'
                }`}
              >
                <span className="inline-flex min-w-0 items-center gap-2.5">
                  <Icon
                    size={16}
                    aria-hidden="true"
                    className={selected ? 'shrink-0 text-(--nav-selected-text)' : 'shrink-0'}
                  />
                  <span className="truncate">{item.label}</span>
                </span>
                {dirty && (
                  <>
                    <span className="size-2 shrink-0 rounded-full bg-warning" aria-hidden="true" />
                    <span className="sr-only">（有未保存更改）</span>
                  </>
                )}
              </button>
            );
          })}

          {admin && (
            <>
              <div className="my-2 border-t-[1px] border-border" />
              <button
                type="button"
                aria-current={section === 'security' ? 'page' : undefined}
                onClick={() => setSection('security')}
                className={`flex w-full items-center gap-2.5 rounded-(--radius-control) px-3 py-2 text-(length:--text-sm) transition-colors ${
                  section === 'security'
                    ? 'bg-(--nav-selected) font-medium text-foreground'
                    : 'text-text-secondary hover:bg-surface-muted hover:text-foreground'
                }`}
              >
                <Shield
                  size={16}
                  aria-hidden="true"
                  className={section === 'security' ? 'shrink-0 text-danger' : 'shrink-0'}
                />
                <span className="truncate">凭据与安全</span>
              </button>
            </>
          )}
        </nav>
      </aside>

      {/* Focused Right Content Column */}
      <div className="min-w-0 max-w-3xl space-y-6">
        {/* Contextual Agent Sync Status Strip */}
        {showSyncStrip && (
          <section
            aria-label="同步状态与版本"
            className="space-y-2 rounded-(--radius-surface) border-[1px] border-border bg-surface px-4 py-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                <span className={`size-2 shrink-0 rounded-full ${syncMeta.dotClass}`} />
                <span className="text-(length:--text-sm) font-medium text-foreground tabular-nums">
                  {syncMeta.title}
                </span>
                <Badge tone={syncMeta.badgeTone} size="sm" pill className="tabular-nums">
                  {syncMeta.badgeText}
                </Badge>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={loading || saving}
                onClick={() => void reloadSettings()}
              >
                <RefreshCw size={14} aria-hidden="true" />
                重新读取
              </Button>
            </div>
            {syncState === 'failed' && (
              <p className="pl-4.5 text-(length:--text-xs) text-danger">
                {status?.result?.error_code === 'persist_failed'
                  ? '请检查节点状态目录权限和磁盘空间。'
                  : '请核对 TCP 公网目标、网卡名称及 Agent 版本是否支持面板下发目标。'}
              </p>
            )}
          </section>
        )}

        {/* Section Content */}
        <form
          noValidate
          aria-busy={loading || saving}
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {section === 'general' && (
            <div className="space-y-6">
              {node && (
                <NodeIdentitySettings
                  node={node}
                  session={session}
                  admin={admin}
                  catalogState={catalogState}
                  onChanged={onChanged}
                />
              )}
              {node && (
                <Input
                  label="节点域名"
                  description="新建服务和中转线路时优先填入此域名。留空时使用节点公网 IP。"
                  placeholder="node.example.com"
                  value={domainDraft?.value ?? currentDomain}
                  readOnly={!admin}
                  disabled={saving}
                  maxLength={254}
                  autoCapitalize="none"
                  spellCheck={false}
                  onChange={(event) => {
                    const value = event.target.value;
                    const expected = domainDraft?.expected ?? currentDomain;
                    setDomainDraft(value === currentDomain ? undefined : { value, expected });
                  }}
                />
              )}
              {admin && billingForm && (
                <NodeBillingSettings
                  form={billingForm}
                  setDraft={setBillingForm}
                  pending={saving}
                />
              )}
            </div>
          )}

          {section === 'traffic' && (
            <div id="traffic-settings">
              <TrafficSettingsFields
                values={flow}
                onChange={setFlow}
                traffic={traffic}
                disabled={formDisabled}
                calibrationSlot={
                  admin ? (
                    <TrafficCalibration id={id} traffic={traffic} enabled={admin && negotiated} />
                  ) : undefined
                }
              />
            </div>
          )}

          {section === 'monitoring' && (
            <NodeMonitoringSettings
              values={values}
              desired={desired}
              admin={admin}
              disabled={formDisabled}
              onChange={(patch) => setValues((old) => ({ ...old, ...patch }))}
            />
          )}

          {section === 'agent' && (
            <div className="space-y-6">
              {node && active && (
                <AgentUpdates key={id} id={id} name={node.name || id} session={session} />
              )}

              <section aria-labelledby="node-log-level-heading" className="space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2
                    id="node-log-level-heading"
                    className="text-(length:--text-base) font-medium text-foreground"
                  >
                    节点运行日志等级
                  </h2>
                  {admin && (
                    <span className="text-(length:--text-xs) text-text-secondary">
                      需点击底部保存生效
                    </span>
                  )}
                </div>

                <div className="space-y-3 rounded-(--radius-surface) border-[1px] border-border bg-surface p-4 sm:px-5">
                  <fieldset disabled={formDisabled} className="max-w-full overflow-x-auto">
                    <SegmentedControl
                      label="节点运行日志等级"
                      options={logLevelOptions}
                      value={values.log_level}
                      onValueChange={(val) => {
                        if (!formDisabled)
                          setValues((old) => ({
                            ...old,
                            log_level: val as TelemetryFormValues['log_level'],
                          }));
                      }}
                    />
                  </fieldset>
                  <p className="text-(length:--text-xs) text-text-secondary">
                    {logLevelHints[values.log_level] ?? ''}
                  </p>
                </div>
              </section>
            </div>
          )}
        </form>

        {section === 'security' && admin && node && (
          <NodeDangerZone node={node} session={session} onChanged={onChanged} />
        )}

        {/* Content-Aligned Sticky Dirty Save Bar */}
        {active && admin && dirtySections.length > 0 && (
          <aside
            aria-label="未保存设置提示"
            className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-(--radius-surface) border-[1px] border-border bg-surface-raised px-4 py-3 shadow-(--shadow-floating)"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="size-2 shrink-0 rounded-full bg-warning" />
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-(length:--text-sm) font-medium text-foreground">
                  有未保存的更改
                </span>
                <span className="text-(length:--text-xs) text-text-secondary">
                  {dirtySections.map((d) => d.label).join('、')}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={saving || (telemetryDirty && loading)}
                onClick={discard}
              >
                <Undo2 size={14} aria-hidden="true" />
                放弃更改
              </Button>
              <Button
                type="button"
                size="sm"
                loading={saving}
                disabled={saving || (telemetryDirty && loading)}
                onClick={() => void save()}
              >
                <Save size={14} aria-hidden="true" />
                保存更改
              </Button>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
