import { useRef, useState } from "react";
import { useOutletContext } from "react-router";
import { type PanelSettings, saveSettings } from "@/api/settings";
import { Button } from "@/components/arc/button/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
} from "@/components/arc/dialog/dialog";
import { Input } from "@/components/arc/input/input";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { Switch } from "@/components/arc/switch/switch";
import { useToastFeedback } from "@/hooks/use-toast-feedback";
import type { PanelContext } from "@/layouts/PanelContext";
import SettingsSection from "./SettingsSection";

const behaviors = [
  {
    key: "sse",
    title: "实时推送（SSE）",
    description: "状态变化时推送到已打开的面板页面",
  },
  {
    key: "alerts",
    title: "离线告警",
    description: "节点断线或心跳超时后，在通知中显示离线告警",
  },
  {
    key: "auto_backup",
    title: "每日自动备份",
    description: "每天 03:00 UTC 备份 SQLite 并保留 14 天",
  },
  {
    key: "telemetry",
    title: "匿名遥测",
    description: "发送匿名版本与用量统计（默认关闭）",
  },
] as const;
export default function GeneralSettings() {
  const context = useOutletContext<PanelContext>();
  const initial = context.panelSettings?.settings;
  return (
    <GeneralForm
      key={initial ? "loaded" : "unavailable"}
      context={context}
      initial={initial}
    />
  );
}
function GeneralForm({
  context,
  initial,
}: {
  context: PanelContext;
  initial: PanelSettings | undefined;
}) {
  const [name, setName] = useState(initial?.panel_name ?? "");
  const [origin, setOrigin] = useState(initial?.public_origin ?? "");
  const [theme, setTheme] = useState<string>(initial?.theme ?? "");
  const [, setFeedback] = useToastFeedback("success");
  const [, setError] = useToastFeedback("error");
  const [pending, setPending] = useState<keyof PanelSettings | "panel" | null>(
    null,
  );
  const [confirm, setConfirm] = useState(false);
  const busy = useRef(false);
  const admin = context.user.role === "admin";
  const available = !!context.panelSettings;
  const current = context.panelSettings?.settings ?? initial;
  async function persist(
    next: PanelSettings,
    action: keyof PanelSettings | "panel" = "panel",
  ) {
    if (busy.current || !available) return;
    busy.current = true;
    setPending(action);
    setFeedback("");
    setError("");
    try {
      const saved = await saveSettings(context, next);
      context.updateSettings(saved);
      setFeedback("设置已保存。");
      setConfirm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存未完成，请重试。");
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
      theme: theme as PanelSettings["theme"],
    });
  return (
    <>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
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
            <fieldset
              disabled={!admin || !available}
              className="min-w-0 space-y-5"
            >
              <Input
                label="面板名称"
                placeholder={available ? undefined : "尚未读取"}
                readOnly={!!pending}
                value={name}
                required
                maxLength={128}
                onChange={(event) => setName(event.target.value)}
              />
              <Input
                label="公开 Origin"
                placeholder={available ? undefined : "尚未读取"}
                readOnly={!!pending}
                value={origin}
                type="url"
                required
                onChange={(event) => setOrigin(event.target.value)}
                description="浏览器与 Agent 共用，生产环境必须为 HTTPS 且不带路径。"
              />
              <div className="space-y-2" aria-disabled={!!pending}>
                <p className="text-foreground">默认主题</p>
                <SegmentedControl
                  label="默认主题"
                  value={theme}
                  onValueChange={(value) => {
                    if (!busy.current) setTheme(value);
                  }}
                  options={[
                    { value: "dark", label: "深色" },
                    { value: "light", label: "浅色" },
                    { value: "system", label: "跟随系统" },
                  ]}
                />
              </div>
              <Button
                type="submit"
                loading={pending === "panel"}
                aria-disabled={!!pending}
              >
                保存设置
              </Button>
            </fieldset>

            {!admin && (
              <p className="text-(length:--text-xs) text-text-secondary">
                仅管理员可修改系统设置。
              </p>
            )}
            {available &&
              context.panelSettings?.active_origin !==
                current?.public_origin && (
                <p
                  role="status"
                  className="text-(length:--text-xs) text-text-secondary"
                >
                  公开 Origin 已保存，重启 Panel 后生效。请同步更新反向代理与
                  Agent 连接地址。
                </p>
              )}
          </form>
        </SettingsSection>
        <SettingsSection title="行为">
          <div className="divide-y-[0.5px] divide-border">
            {behaviors.map(({ key, title, description }) => (
              <div
                key={key}
                className="flex min-h-20 items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="text-foreground">{title}</p>
                  <p className="mt-1 text-(length:--text-xs) text-text-secondary">
                    {description}
                  </p>
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
        >
          <div className="flex flex-wrap gap-2">
            <DialogClose asChild>
              <Button variant="secondary">取消</Button>
            </DialogClose>
            <Button loading={pending === "panel"} onClick={save}>
              保存新地址
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
