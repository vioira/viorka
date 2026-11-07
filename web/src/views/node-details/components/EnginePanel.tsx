import { useEffect, useRef, useState } from 'react';
import QRCode from 'react-qr-code';
import type { Session } from '@/api/auth';
import {
  type Connection,
  type EngineDraft,
  type EngineRecord,
  type EngineService,
  engineAction,
  engineConnections,
  engineStatus,
  engineSyncError,
  retryEngineSync,
  saveDraft,
} from '@/api/engines';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/arc/dialog/dialog';
import { Input } from '@/components/arc/input/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/arc/tabs/tabs';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import EngineOperation from './EngineOperation';
import EngineRouting from './EngineRouting';
import EngineRuntime from './EngineRuntime';
import EngineServiceTable from './EngineServiceTable';
import PresetServiceEditor from './PresetServiceEditor';
import ServiceEditor from './ServiceEditor';

export default function EnginePanel({
  engine,
  nodeIP,
  nodeName,
  active,
  session,
  online,
  refresh,
}: {
  engine: EngineRecord;
  nodeIP: string;
  nodeName: string;
  active: boolean;
  session: Session;
  online: boolean;
  refresh: () => Promise<void>;
}) {
  const { toast } = useToastStack();
  const [draft, setDraft] = useState<EngineDraft>(engine.draft);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState<EngineService | null>(null);
  const rotationFocus = useRef<HTMLElement | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [selected, setSelected] = useState<EngineService | null>(null);
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [revealing, setRevealing] = useState(false);
  const locked = useRef(false);
  const revealRequest = useRef(0);
  const revealFocus = useRef<HTMLElement | null>(null);
  const canEdit =
    session.user.role !== 'viewer' &&
    engine.ownership === 'managed' &&
    engine.status !== 'not_installed';
  useEffect(() => {
    if (!dirty && engine.draft.version >= draft.version) setDraft(engine.draft);
  }, [engine.draft, dirty, draft.version]);
  useEffect(() => {
    if (!active) {
      setSelected(null);
      setConnections(null);
      setDiscarding(false);
    }
    return () => {
      revealRequest.current += 1;
    };
  }, [active]);
  const changed = dirty && engine.draft.version !== draft.version;
  function update(services: EngineService[]) {
    setDraft({ ...draft, services });
    setDirty(true);
  }
  async function save() {
    if (locked.current) return;
    locked.current = true;
    setSaving(true);
    try {
      const saved = await saveDraft(engine.id, draft, session);
      setDraft(saved);
      setDirty(false);
      toast({ type: 'success', title: '草稿已保存', description: '尚未应用到节点。' });
      await refresh();
    } catch (error) {
      toast({
        id: `draft-${engine.id}`,
        type: 'error',
        title: '草稿未能保存',
        description: error instanceof Error ? error.message : '请刷新后检查版本。',
      });
    } finally {
      locked.current = false;
      setSaving(false);
    }
  }
  async function reveal(serviceId?: string) {
    const request = ++revealRequest.current;
    revealFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setRevealing(true);
    try {
      const result = await engineConnections(engine.id, session);
      if (request === revealRequest.current)
        setConnections(serviceId ? result.filter((item) => item.service_id === serviceId) : result);
    } catch (error) {
      if (request === revealRequest.current)
        toast({
          id: `connections-${engine.id}`,
          type: 'error',
          title: '未能读取连接信息',
          description:
            error instanceof Error
              ? error.message
              : '需要成功应用配置、登记对外入口并获得凭证权限。',
        });
    } finally {
      setRevealing(false);
    }
  }
  return (
    <section className="min-w-0 space-y-6" aria-label={engine.name}>
      <EngineRuntime
        engine={engine}
        session={session}
        online={online}
        dirty={dirty || saving}
        canEdit={canEdit}
        refresh={refresh}
      />
      <section aria-label="草稿与发布状态" className="v-card justify-between flex">
        <div className="min-w-0 space-y-2">
          <p className="font-medium" role="status">
            {changed
              ? '共享草稿已更新，本地修改保留'
              : dirty
                ? '本地修改尚未保存'
                : '共享草稿已保存'}
          </p>
          <p className="text-(length:--text-xs) text-text-secondary" role="status">
            {engine.sync_state === 'failed'
              ? engineSyncError(engine.sync_error ?? '')
              : engine.sync_state === 'syncing'
                ? '配置同步中，等待 Agent 确认'
                : engine.sync_state === 'pending'
                  ? online
                    ? '待同步最新配置'
                    : '待节点上线后同步最新配置'
                  : engine.sync_state === 'unpublished'
                    ? '尚无已发布配置'
                    : 'Agent 已确认配置同步'}
          </p>
          <p className="text-(length:--text-xs) text-text-secondary tabular-nums">
            草稿 v{draft.version} / 期望修订 r{engine.desired_revision} / 已确认修订 r
            {engine.observed_revision}
          </p>
          <p className="text-(length:--text-xs) text-text-secondary">
            {changed
              ? '请保留需要的内容，放弃本地修改后重新编辑最新草稿。'
              : dirty
                ? '保存草稿后，应用配置才会影响节点。'
                : engine.desired_revision !== engine.observed_revision
                  ? '最新目标尚未得到 Agent 确认；同步成功后更新已确认修订。'
                  : '服务修改需单独应用；已确认修订不代表当前草稿已发布。'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {engine.sync_state === 'failed' && (
            <Button
              className="min-h-11"
              variant="secondary"
              disabled={
                !canEdit || saving || engine.status === 'unknown' || engine.status === 'degraded'
              }
              onClick={async () => {
                try {
                  await retryEngineSync(engine.id, session);
                  toast({
                    id: `sync-${engine.id}`,
                    type: 'success',
                    title: '已请求重新同步',
                    description: online
                      ? '等待 Agent 应用最新目标配置。'
                      : '节点上线后同步最新目标配置。',
                  });
                  await refresh();
                } catch (error) {
                  toast({
                    id: `sync-${engine.id}`,
                    type: 'error',
                    title: '未能重试同步',
                    description: error instanceof Error ? error.message : '请核对引擎状态后重试。',
                  });
                }
              }}
            >
              重试同步
            </Button>
          )}
          {dirty ? (
            <>
              <Dialog open={discarding} onOpenChange={setDiscarding}>
                <DialogTrigger asChild>
                  <Button variant="secondary" className="min-h-11" disabled={saving}>
                    放弃修改
                  </Button>
                </DialogTrigger>
                <DialogContent
                  title="放弃本地修改"
                  description="丢弃尚未保存的内容，并读取最新共享草稿。"
                  footer={
                    <>
                      <Button variant="secondary" onClick={() => setDiscarding(false)}>
                        继续编辑
                      </Button>
                      <Button
                        onClick={() => {
                          setDraft(engine.draft);
                          setDirty(false);
                          setDiscarding(false);
                        }}
                      >
                        放弃修改
                      </Button>
                    </>
                  }
                />
              </Dialog>
              <Button
                className="min-h-11"
                disabled={!canEdit || changed || saving}
                loading={saving}
                onClick={() => void save()}
              >
                保存草稿
              </Button>
            </>
          ) : (
            <EngineOperation
              title="应用配置"
              variant="primary"
              description={`将已保存草稿应用到 ${engine.name} 的全部 ${draft.services.length} 项服务及出口、分流配置，可能重启共享进程。保持停止时不会自动启动。`}
              disabled={!online || !canEdit || saving}
              run={(key) => engineAction(engine, 'engine.apply', key, session)}
              onDone={refresh}
            />
          )}
        </div>
      </section>
      <Tabs defaultValue="services">
        {engine.name === 'sing-box' && (
          <TabsList aria-label="引擎配置">
            <TabsTrigger value="services">服务</TabsTrigger>
            <TabsTrigger value="outbounds">出口</TabsTrigger>
            <TabsTrigger value="routing">分流</TabsTrigger>
          </TabsList>
        )}
        <TabsContent value="services">
          <section
            aria-label={engine.name === 'realm' ? 'TCP 转发规则' : '代理服务'}
            className="min-w-0 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1">
                <h3 className="text-(length:--text-base) font-medium">
                  {engine.name === 'realm' ? 'TCP 转发规则' : '代理服务'}
                </h3>
                <p className="text-(length:--text-xs) text-text-secondary">
                  启停、编辑和删除均先暂存草稿，应用后才会在节点生效。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {engine.name !== 'realm' && (
                  <Button
                    variant="secondary"
                    className="min-h-11"
                    disabled={engine.observed_revision === 0 || revealing}
                    onClick={() => void reveal()}
                  >
                    查看连接凭证
                  </Button>
                )}
                <Button
                  variant="secondary"
                  className="min-h-11"
                  disabled={!canEdit || saving || draft.services.length >= 32}
                  onClick={() =>
                    setSelected({
                      id: crypto.randomUUID(),
                      name: '',
                      enabled: true,
                      pending_delete: false,
                      listen_host: engine.name === 'sing-box' ? '::' : '0.0.0.0',
                      listen_port: engine.name === 'realm' ? 10080 : 443,
                      target_host: '',
                      target_port: 443,
                      server_name: '',
                      public_host: nodeIP,
                      public_port: nodeIP ? (engine.name === 'realm' ? 10080 : 443) : 0,
                    })
                  }
                >
                  {engine.name === 'realm' ? '添加转发规则' : '添加服务'}
                </Button>
              </div>
            </div>
            <EngineServiceTable
              services={draft.services}
              realm={engine.name === 'realm'}
              disabled={!canEdit || saving}
              canReveal={engine.observed_revision > 0 && !revealing}
              canRotate={online && canEdit && !dirty && !saving}
              onRotate={(service, trigger) => {
                rotationFocus.current = trigger;
                setRotating(service);
              }}
              onUpdate={update}
              onEdit={setSelected}
              onReveal={(id) => void reveal(id)}
            />
          </section>
        </TabsContent>
        {engine.name === 'sing-box' &&
          (['outbounds', 'routing'] as const).map((view) => (
            <TabsContent key={view} value={view}>
              <EngineRouting
                routing={draft.routing}
                services={draft.services}
                disabled={!canEdit || saving}
                view={view}
                onChange={(routing) => {
                  setDraft({ ...draft, routing });
                  setDirty(true);
                }}
              />
            </TabsContent>
          ))}
      </Tabs>
      {rotating && (
        <EngineOperation
          title="更换凭证"
          description={`为 ${rotating.name} 生成新凭证，并应用整个已保存草稿。成功后旧凭证失效，需要重新分发连接信息。`}
          disabled={!online || !canEdit || dirty || saving}
          open
          onOpenChange={(open) => {
            if (!open) setRotating(null);
          }}
          returnFocus={() => rotationFocus.current?.focus()}
          run={(key) =>
            engineAction(engine, 'engine.apply', key, session, { rotate_service_id: rotating.id })
          }
          onDone={() => {
            setConnections(null);
            return refresh();
          }}
        />
      )}
      {selected &&
      engine.name !== 'realm' &&
      (selected.preset_id || !draft.services.some((item) => item.id === selected.id)) ? (
        <PresetServiceEditor
          nodeName={nodeName}
          key={selected.id}
          service={selected}
          engine={engine.name}
          editing={draft.services.some((item) => item.id === selected.id)}
          onClose={() => setSelected(null)}
          onSave={(service) => {
            update(
              draft.services.some((item) => item.id === service.id)
                ? draft.services.map((item) => (item.id === service.id ? service : item))
                : [...draft.services, service],
            );
            setSelected(null);
          }}
        />
      ) : (
        <ServiceEditor
          key={selected?.id ?? 'closed'}
          editing={draft.services.some((item) => item.id === selected?.id)}
          service={selected}
          engine={engine.name}
          onClose={() => setSelected(null)}
          onSave={(service) => {
            update(
              draft.services.some((item) => item.id === service.id)
                ? draft.services.map((item) => (item.id === service.id ? service : item))
                : [...draft.services, service],
            );
            setSelected(null);
          }}
        />
      )}
      <Dialog
        open={connections !== null}
        onOpenChange={(open) => {
          if (!open) setConnections(null);
        }}
      >
        <DialogContent
          title="已应用连接信息"
          description="仅展示已应用版本，草稿修改不影响这些参数。包含客户端凭证，请妥善保管；外部连通尚未验证。"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            revealFocus.current?.focus();
          }}
        >
          {connections?.length === 0 ? (
            <p>所选服务尚无已应用的连接信息，或未登记对外入口。</p>
          ) : (
            connections?.map((item) => (
              <div key={item.service_id} className="space-y-3 border-b-[1px] border-border pb-4">
                <Input
                  label={`${item.name} / 修订 ${item.revision}`}
                  value={item.url}
                  readOnly
                  onFocus={(event) => event.currentTarget.select()}
                />
                {/* The QR code keeps its original black/white quiet zone as encoded image content. */}
                <div className="w-fit max-w-full bg-white p-4">
                  <QRCode value={item.url} size={192} title={`${item.name} 客户端连接二维码`} />
                </div>
                <p className="text-text-secondary">
                  {online ? engineStatus(item.runtime_status) : '节点离线，运行状态未确认'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    className="min-h-11"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(item.url);
                        toast({
                          id: 'engine-connection-copy',
                          type: 'success',
                          title: '连接链接已复制',
                        });
                      } catch {
                        toast({
                          id: 'engine-connection-copy',
                          type: 'error',
                          title: '无法复制链接',
                          description: '请选中连接链接后手动复制。',
                        });
                      }
                    }}
                  >
                    复制链接
                  </Button>
                  <EngineOperation
                    title="更换凭证"
                    description="为此服务生成新凭证，并应用整个已保存草稿。成功后旧凭证失效，需要重新分发连接信息。"
                    disabled={
                      !online ||
                      !canEdit ||
                      dirty ||
                      saving ||
                      !draft.services.some(
                        (service) => service.id === item.service_id && !service.pending_delete,
                      )
                    }
                    run={(key) =>
                      engineAction(engine, 'engine.apply', key, session, {
                        rotate_service_id: item.service_id,
                      })
                    }
                    onDone={() => {
                      setConnections(null);
                      return refresh();
                    }}
                  />
                </div>
              </div>
            ))
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
