import { useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router';
import { type PanelSettings, saveSettings } from '@/api/settings';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogClose, DialogContent } from '@/components/arc/dialog/dialog';
import { Input } from '@/components/arc/input/input';
import { Switch } from '@/components/arc/switch/switch';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import type { PanelContext } from '@/layouts/PanelContext';
import SettingsSection from './SettingsSection';

const behaviors = [
  {
    key: 'sse',
    title: '自动实时更新',
    description: '自动接收状态与指标更新；关闭后仍可查询和保存配置',
  },
  {
    key: 'alerts',
    title: '离线告警',
    description: '超过离线心跳超时后，在通知中显示离线告警',
  },
  {
    key: 'telemetry',
    title: '匿名遥测',
    description: '发送匿名版本与用量统计（默认关闭）',
  },
] as const;
export default function GeneralSettings() {
  const context = useOutletContext<PanelContext>();
  const initial = context.panelSettings?.settings;
  return (
    <GeneralForm key={initial ? 'loaded' : 'unavailable'} context={context} initial={initial} />
  );
}
function GeneralForm({
  context,
  initial,
}: {
  context: PanelContext;
  initial: PanelSettings | undefined;
}) {
  const [probeTargets, setProbeTargets] = useState((initial?.tcp_probe_targets ?? []).join(', '));
  const probeEditRevision = useRef<number | null>(null);
  const [name, setName] = useState(initial?.panel_name ?? '');
  const [origin, setOrigin] = useState(initial?.public_origin ?? '');
  const [heartbeatTimeout, setHeartbeatTimeout] = useState(
    initial?.heartbeat_timeout_seconds.toString() ?? '',
  );
  const [, setFeedback] = useToastFeedback('success');
  const [, setError] = useToastFeedback('error');
  const [pending, setPending] = useState<keyof PanelSettings | 'panel' | null>(null);
  const [confirm, setConfirm] = useState(false);
  const busy = useRef(false);
  const admin = context.user.role === 'admin';
  const available = !!context.panelSettings;
  const current = context.panelSettings?.settings ?? initial;
  useEffect(() => {
    if (probeEditRevision.current === null)
      setProbeTargets((current?.tcp_probe_targets ?? []).join(', '));
  }, [current?.tcp_probe_targets]);
  async function persist(next: PanelSettings, action: keyof PanelSettings | 'panel' = 'panel') {
    if (busy.current || !available) return;
    busy.current = true;
    setPending(action);
    setFeedback('');
    setError('');
    try {
      const saved = await saveSettings(context, next);
      context.updateSettings(saved);
      if (action === 'tcp_probe_targets') {
        probeEditRevision.current = null;
        setProbeTargets((saved.settings.tcp_probe_targets ?? []).join(', '));
      }
      setFeedback('设置已保存。');
      setConfirm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存未完成，请重试。');
    } finally {
      busy.current = false;
      setPending(null);
    }
  }
  const save = () =>
    current &&
    persist({
      ...current,
      panel_name: name,
      public_origin: origin,
      heartbeat_timeout_seconds: Number(heartbeatTimeout),
    });
  return (
    <>
      <div className="space-y-4">
        <SettingsSection title="面板">
          <form
            aria-busy={!!pending || (!available && !context.settingsError)}
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (busy.current || !available || !admin) return;
              if (origin !== current?.public_origin) setConfirm(true);
              else void save();
            }}
          >
            <fieldset disabled={!admin || !available} className="min-w-0 space-y-5">
              <Input
                label="面板名称"
                placeholder={available ? undefined : '尚未读取'}
                readOnly={!!pending}
                value={name}
                required
                maxLength={128}
                onChange={(event) => setName(event.target.value)}
              />
              <Input
                label="公开 Origin"
                placeholder={available ? undefined : '尚未读取'}
                readOnly={!!pending}
                value={origin}
                type="url"
                required
                onChange={(event) => setOrigin(event.target.value)}
                description="浏览器与 Agent 共用，生产环境必须为 HTTPS 且不带路径。"
              />
              <Input
                label="离线心跳超时（秒）"
                type="number"
                min={60}
                max={3600}
                step={1}
                required
                className="tabular-nums"
                placeholder={available ? undefined : '尚未读取'}
                readOnly={!!pending}
                value={heartbeatTimeout}
                onChange={(event) => setHeartbeatTimeout(event.target.value)}
                description="60–3600 秒，保存后生效。断线后也从最后一次心跳起计时。"
              />
              <Button type="submit" loading={pending === 'panel'} aria-disabled={!!pending}>
                保存设置
              </Button>
            </fieldset>

            {!admin && (
              <p className="text-(length:--text-xs) text-text-secondary">
                仅管理员可修改系统设置。
              </p>
            )}
            {available && context.panelSettings?.active_origin !== current?.public_origin && (
              <p role="status" className="text-(length:--text-xs) text-text-secondary">
                公开 Origin 已保存，重启 Panel 后生效。请同步更新反向代理与 Agent 连接地址。
              </p>
            )}
          </form>
        </SettingsSection>
        <SettingsSection title="全局 TCP 探测目标">
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!current || !admin) return;
              const targets = probeTargets
                .split(/[,，]/)
                .map((target) => target.trim())
                .filter(Boolean);
              if (targets.length > 3) {
                setError('最多填写 3 个公网 host:port。');
                return;
              }
              void persist(
                {
                  ...current,
                  revision: probeEditRevision.current ?? current.revision,
                  tcp_probe_targets: targets,
                },
                'tcp_probe_targets',
              );
            }}
          >
            <Input
              label="TCP 探测目标"
              value={probeTargets}
              disabled={!admin || !available || !!pending}
              placeholder="example.com:443, 1.1.1.1:443"
              description="最多 3 个公网 host:port，以逗号分隔。留空关闭继承节点的探测。"
              onChange={(event) => {
                probeEditRevision.current ??= current?.revision ?? null;
                setProbeTargets(event.target.value);
              }}
            />
            <Button
              type="submit"
              disabled={!admin || !available || !!pending}
              loading={pending === 'tcp_probe_targets'}
            >
              保存全局目标
            </Button>
          </form>
        </SettingsSection>
        <SettingsSection title="行为">
          <div className="divide-y-[1px] divide-border">
            {behaviors.map(({ key, title, description }) => (
              <div
                key={key}
                className="flex min-h-20 items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="text-foreground">{title}</p>
                  <p className="mt-1 text-(length:--text-xs) text-text-secondary">{description}</p>
                </div>
                <Switch
                  aria-label={available ? title : `${title}，尚未读取`}
                  disabled={!admin || !available}
                  aria-disabled={!!pending || !admin || !available}
                  aria-busy={pending === key}
                  checked={current?.[key] ?? false}
                  onCheckedChange={(checked) =>
                    current && void persist({ ...current, [key]: checked }, key)
                  }
                />
              </div>
            ))}
          </div>
        </SettingsSection>
      </div>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent
          title="更改公开 Origin？"
          description="此设置将在重启 Panel 后生效。请先配置新地址的证书与反向代理，并准备更新 Agent 连接地址，否则可能无法访问面板。"
          footer={
            <>
              <DialogClose asChild>
                <Button variant="secondary">取消</Button>
              </DialogClose>
              <Button loading={pending === 'panel'} onClick={save}>
                保存新地址
              </Button>
            </>
          }
        />
      </Dialog>
    </>
  );
}
