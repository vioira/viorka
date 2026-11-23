import { Activity, FileText, Plus, RefreshCw, Send } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useOutletContext } from 'react-router';
import {
  type AlertChannel,
  type AlertConfig,
  type AlertRule,
  type AlertSettings,
  type AlertTemplate,
  getAlertSettings,
  saveAlertSettings,
  testAlertChannel,
} from '@/api/alerts';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { Drawer, DrawerContent } from '@/components/arc/drawer/drawer';
import { Input } from '@/components/arc/input/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/arc/tabs/tabs';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import type { PanelContext } from '@/layouts/PanelContext';
import ChannelEditor from './components/ChannelEditor';
import ChannelList from './components/ChannelList';
import NotificationOverview from './components/NotificationOverview';
import RuleEditor, { newRule } from './components/RuleEditor';
import RuleList from './components/RuleList';
import RuleStatus from './components/RuleStatus';
import TemplateEditor from './components/TemplateEditor';

type Area = 'rules' | 'channels' | 'templates';
type Editor =
  | { kind: 'rules'; value: AlertRule }
  | { kind: 'channels'; value: AlertChannel }
  | { kind: 'templates'; value: AlertTemplate };
const areas = {
  rules: '告警规则',
  channels: '推送渠道',
  templates: '消息模板',
};
const objects = { rules: '规则', channels: '渠道', templates: '模板' };
function replace<T extends { id: string }>(items: T[], value: T) {
  return items.some((x) => x.id === value.id)
    ? items.map((x) => (x.id === value.id ? value : x))
    : [...items, value];
}
export default function NotificationSettings() {
  const session = useOutletContext<PanelContext>();
  if (session.user.role !== 'admin') return <Navigate to="/settings" replace />;
  return <NotificationWorkspace token={session.csrf_token} />;
}
function NotificationWorkspace({ token }: { token: string }) {
  const [zoneOpen, setZoneOpen] = useState(false);
  const [templateId, selectTemplate] = useState('default');
  const [data, setData] = useState<AlertSettings | null>(null);
  const [area, choose] = useState<Area>('rules');
  const [edit, open] = useState<Editor | null>(null);
  const [status, inspect] = useState<AlertRule | null>(null);
  const [remove, confirm] = useState<{ id: string; name: string } | null>(null);
  const [zone, setZone] = useState('');
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const trigger = useRef<HTMLElement | null>(null);
  function rememberFocus() {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  function restoreFocus(event: Event) {
    if (trigger.current?.isConnected) {
      event.preventDefault();
      trigger.current.focus();
    }
  }

  const [loading, setLoading] = useState(false);
  const [, error] = useToastFeedback('error', 'notifications-config');
  const [, success] = useToastFeedback('success');
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const v = await getAlertSettings(signal);
        if (!signal?.aborted) {
          setData(v);
          setZone(v.config.timezone);
        }
      } catch (e) {
        if (!signal?.aborted) error((e as Error).message);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [error],
  );
  useEffect(() => {
    const ctl = new AbortController();
    void refresh(ctl.signal);
    return () => ctl.abort();
  }, [refresh]);
  async function save(c: AlertConfig, secrets?: Record<string, string>) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const next = await saveAlertSettings(token, c, secrets);
      setData(next);
      setZone(next.config.timezone);
      open(null);
      confirm(null);
      setZoneOpen(false);
      success('通知设置已保存。');
    } catch (e) {
      error((e as Error).message);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function test(id: string) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      await testAlertChannel(token, id);
      success('测试通知已加入投递队列。');
      await refresh();
    } catch (e) {
      error((e as Error).message);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  const c = data?.config;
  const disabled = pending || loading || !c;
  const template =
    edit?.kind === 'templates'
      ? edit.value
      : (c?.templates.find((t) => t.id === templateId) ?? c?.templates[0]);
  function create() {
    if (!c) return;
    rememberFocus();
    if (area === 'rules') open({ kind: area, value: newRule() });
    if (area === 'channels')
      open({
        kind: area,
        value: { id: crypto.randomUUID(), name: '', kind: 'telegram', target: '' },
      });
    if (area === 'templates') {
      const t = c.templates.find((x) => x.id === 'default');
      if (t) open({ kind: area, value: { ...t, id: crypto.randomUUID(), name: '' } });
    }
  }
  return (
    <div className="min-w-0 space-y-6">
      <NotificationOverview
        data={data}
        disabled={disabled}
        editZone={() => {
          rememberFocus();
          setZone(c?.timezone ?? '');
          setZoneOpen(true);
        }}
      />
      <Tabs
        value={area}
        onValueChange={(v) => {
          choose(v as Area);
          open(null);
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
          <div className="max-w-full min-w-0">
            <TabsList borderless aria-label="通知与告警分类">
              {(Object.keys(areas) as Area[]).map((key) => {
                const Icon = { rules: Activity, channels: Send, templates: FileText }[key];
                return (
                  <TabsTrigger key={key} value={key} disabled={pending} aria-label={areas[key]}>
                    <span className="flex items-center gap-2">
                      <Icon className="hidden sm:block" aria-hidden="true" size={16} />
                      {areas[key]}
                      {c && (
                        <span className="tabular-nums text-(length:--text-xs)">
                          {c[key].length}
                        </span>
                      )}
                    </span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              disabled={pending || loading}
              onClick={() => void refresh()}
              aria-label="刷新通知设置"
              title="刷新通知设置"
            >
              <RefreshCw aria-hidden="true" size={16} />
            </Button>
            <Button disabled={disabled} onClick={create}>
              <Plus size={16} aria-hidden="true" />
              添加{objects[area]}
            </Button>
          </div>
        </div>
        {!data || !c ? (
          <p className="py-4 text-text-secondary" role="status">
            {loading ? '正在读取通知设置…' : '通知设置尚未读取'}
          </p>
        ) : (
          <>
            <TabsContent value="rules">
              <RuleList
                config={c}
                disabled={disabled}
                onToggle={(r) => void save({ ...c, rules: replace(c.rules, r) })}
                onStatus={(r) => {
                  rememberFocus();
                  inspect(r);
                }}
                onEdit={(value) => {
                  rememberFocus();
                  open({ kind: 'rules', value });
                }}
                onDelete={confirm}
              />
            </TabsContent>
            <TabsContent value="channels">
              <ChannelList
                data={data}
                disabled={disabled}
                onTest={test}
                onEdit={(value) => {
                  rememberFocus();
                  open({ kind: 'channels', value });
                }}
                onDelete={confirm}
              />
            </TabsContent>
            <TabsContent value="templates">
              <div className="grid items-start gap-6 lg:grid-cols-[minmax(12rem,1fr)_minmax(0,3fr)]">
                <div className="min-w-0 space-y-2">
                  <h2 className="font-medium text-foreground">模板列表</h2>
                  <div className="flex flex-wrap gap-2 lg:flex-col">
                    {c.templates.map((t) => (
                      <Button
                        key={t.id}
                        variant={template?.id === t.id ? 'secondary' : 'ghost'}
                        aria-pressed={template?.id === t.id}
                        disabled={disabled}
                        onClick={() => {
                          selectTemplate(t.id);
                          open(null);
                        }}
                      >
                        <span className="break-all">{t.name}</span>
                      </Button>
                    ))}
                  </div>
                </div>
                {template && (
                  <section className="min-w-0 space-y-4 rounded-(--radius-panel) border border-border bg-surface p-4 lg:p-6">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="min-w-0 break-all font-medium text-foreground">
                        {edit?.kind === 'templates' ? '新建模板' : template.name}
                      </h2>
                      {edit?.kind !== 'templates' && (
                        <div className="flex gap-2">
                          <Button
                            variant="secondary"
                            disabled={disabled}
                            onClick={() =>
                              open({
                                kind: 'templates',
                                value: {
                                  ...template,
                                  id: crypto.randomUUID(),
                                  name: `${template.name} 副本`,
                                },
                              })
                            }
                          >
                            复制模板
                          </Button>
                          {template.id !== 'default' && (
                            <Button
                              variant="ghost"
                              disabled={disabled || c.rules.some((r) => r.template === template.id)}
                              onClick={() => confirm(template)}
                            >
                              删除模板
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                    <TemplateEditor
                      key={`${template.id}:${c.revision}`}
                      initial={template}
                      timezone={c.timezone}
                      token={token}
                      pending={disabled}
                      cancel={() => open(null)}
                      save={(v) => {
                        selectTemplate(v.id);
                        void save({ ...c, templates: replace(c.templates, v) });
                      }}
                    />
                  </section>
                )}
              </div>
            </TabsContent>
          </>
        )}
      </Tabs>
      <Drawer
        open={!!status || edit?.kind === 'rules' || edit?.kind === 'channels'}
        onOpenChange={(v) => {
          if (!v && !pending) {
            inspect(null);
            open(null);
          }
        }}
      >
        <DrawerContent
          onCloseAutoFocus={restoreFocus}
          title={
            status
              ? `规则状态：${status.name}`
              : edit && c
                ? `${c[edit.kind].some((x) => x.id === edit.value.id) ? '编辑' : '添加'}${objects[edit.kind]}`
                : '规则详情'
          }
        >
          {status && <RuleStatus id={status.id} />}
          {edit?.kind === 'rules' && c && (
            <RuleEditor
              key={edit.value.id}
              initial={edit.value}
              config={c}
              pending={pending}
              cancel={() => open(null)}
              save={(r) => void save({ ...c, rules: replace(c.rules, r) })}
            />
          )}
          {edit?.kind === 'channels' && data && c && (
            <ChannelEditor
              key={edit.value.id}
              initial={edit.value}
              hasSecret={!!data.credentials[edit.value.id]}
              pending={pending}
              cancel={() => open(null)}
              save={(v, secret) =>
                void save(
                  { ...c, channels: replace(c.channels, v) },
                  secret ? { [v.id]: secret } : undefined,
                )
              }
            />
          )}
        </DrawerContent>
      </Drawer>
      <Dialog
        open={zoneOpen}
        onOpenChange={(v) => {
          if (!pending) setZoneOpen(v);
        }}
      >
        <DialogContent
          onCloseAutoFocus={restoreFocus}
          title="修改通知时区"
          description="用于通知消息中的时间。节点账期仍使用节点时区。"
          footer={
            <>
              <Button variant="secondary" disabled={pending} onClick={() => setZoneOpen(false)}>
                取消
              </Button>
              <Button
                form="notification-timezone"
                type="submit"
                disabled={disabled || !zone.trim() || zone.trim() === c?.timezone}
              >
                保存时区
              </Button>
            </>
          }
        >
          <form
            className="space-y-3"
            id="notification-timezone"
            onSubmit={(e) => {
              e.preventDefault();
              if (c) void save({ ...c, timezone: zone.trim() });
            }}
          >
            <Input
              label="IANA 时区"
              required
              value={zone}
              placeholder="Asia/Shanghai"
              onChange={(e) => setZone(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              {['Asia/Shanghai', 'UTC', 'America/New_York'].map((t) => (
                <Button
                  key={t}
                  aria-pressed={zone === t}
                  type="button"
                  variant={zone === t ? 'secondary' : 'ghost'}
                  size="sm"
                  disabled={pending}
                  onClick={() => setZone(t)}
                >
                  {t}
                </Button>
              ))}
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!remove}
        onOpenChange={(v) => {
          if (!v && !pending) confirm(null);
        }}
      >
        <DialogContent
          title={`删除${objects[area]}`}
          description={`将删除“${remove?.name ?? ''}”。${area === 'channels' ? '该渠道尚未发出的通知也会取消。' : '此操作无法撤销。'}`}
          footer={
            <>
              <Button variant="secondary" disabled={pending} onClick={() => confirm(null)}>
                取消
              </Button>
              <Button
                variant="danger"
                loading={pending}
                onClick={() => {
                  if (c && remove)
                    void save({ ...c, [area]: c[area].filter((x) => x.id !== remove.id) });
                }}
              >
                确认删除
              </Button>
            </>
          }
        />
      </Dialog>
    </div>
  );
}
