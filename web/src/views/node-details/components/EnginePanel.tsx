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
  saveDraft,
} from '@/api/engines';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { Input } from '@/components/arc/input/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/arc/tabs/tabs';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import EngineOperation from './EngineOperation';
import EnginePipeline from './EnginePipeline';
import EngineRouting from './EngineRouting';
import EngineRuntime from './EngineRuntime';
import EngineServiceTable from './EngineServiceTable';
import PresetServiceEditor from './PresetServiceEditor';
import ReviewDiffDialog from './ReviewDiffDialog';
import ServiceEditor from './ServiceEditor';
import StickyDraftDock from './StickyDraftDock';

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
  const [reviewOpen, setReviewOpen] = useState(false);
  const [rotating, setRotating] = useState<EngineService | null>(null);
  const rotationFocus = useRef<HTMLElement | null>(null);
  const [selected, setSelected] = useState<EngineService | null>(null);
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [revealing, setRevealing] = useState(false);
  const locked = useRef(false);
  const revealRequest = useRef(0);
  const revealFocus = useRef<HTMLElement | null>(null);

  const canEdit =
    session.user.role !== 'viewer' &&
    engine.ownership === 'managed' &&
    engine.status !== 'not_installed' &&
    engine.version !== '' &&
    engine.last_error !== 'engine_external';

  useEffect(() => {
    if (!dirty && engine.draft.version >= draft.version) setDraft(engine.draft);
  }, [engine.draft, dirty, draft.version]);

  useEffect(() => {
    if (!active) {
      setSelected(null);
      setConnections(null);
      setReviewOpen(false);
    }
    return () => {
      revealRequest.current += 1;
    };
  }, [active]);

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
      toast({
        type: 'success',
        title: '草稿已保存',
        description: '可通过流水线审查并发布到节点。',
      });
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

  const activeServices = draft.services.filter((s) => !s.pending_delete);

  return (
    <section className="min-w-0 space-y-4" aria-label={engine.name}>
      {/* 1. Integrated Console Header: Runtime Identity + 3-Stage Pipeline */}
      <div className="rounded-(--radius-panel) border-[1px] border-border overflow-hidden bg-surface shadow-xs">
        <EngineRuntime
          engine={engine}
          session={session}
          online={online}
          dirty={dirty || saving}
          canEdit={canEdit}
          refresh={refresh}
        />
        <EnginePipeline
          engine={engine}
          draftVersion={draft.version}
          dirty={dirty}
          session={session}
          online={online}
          canEdit={canEdit}
          saving={saving}
          onReview={() => setReviewOpen(true)}
          onDeploy={() => setReviewOpen(true)}
          onRefresh={refresh}
        />
      </div>

      {/* 2. Configuration Workspace: Subtabs, Toolbar, Data Table */}
      <div className="rounded-(--radius-panel) border-[1px] border-border bg-surface p-4 space-y-3">
        <Tabs defaultValue="services">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b-[1px] border-border pb-3">
            {engine.name === 'sing-box' ? (
              <TabsList aria-label="引擎配置项">
                <TabsTrigger value="services">
                  代理服务
                  <span className="ml-1 px-1 py-0.2 rounded text-(length:--text-xs) bg-surface-raised tabular-nums">
                    {activeServices.length}
                  </span>
                </TabsTrigger>
                <TabsTrigger value="outbounds">
                  共享出口
                  <span className="ml-1 px-1 py-0.2 rounded text-(length:--text-xs) bg-surface-raised tabular-nums">
                    {draft.routing?.outbound_ids?.length ?? 0}
                  </span>
                </TabsTrigger>
                <TabsTrigger value="routing">
                  分流规则
                  <span className="ml-1 px-1 py-0.2 rounded text-(length:--text-xs) bg-surface-raised tabular-nums">
                    {draft.routing?.rules?.length ?? 0}
                  </span>
                </TabsTrigger>
              </TabsList>
            ) : (
              <h3 className="text-(length:--text-base) font-medium">
                {engine.name === 'realm' ? 'TCP 转发规则' : '代理服务'}
                <span className="ml-1.5 px-1.5 py-0.5 rounded text-(length:--text-xs) bg-surface-raised border-[1px] border-border tabular-nums text-text-secondary">
                  {activeServices.length}
                </span>
              </h3>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {engine.name !== 'realm' && (
                <Button
                  variant="secondary"
                  className="min-h-9"
                  disabled={engine.observed_revision === 0 || revealing}
                  onClick={() => void reveal()}
                >
                  查看连接凭证
                </Button>
              )}
              <Button
                variant="primary"
                className="min-h-9"
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

          <TabsContent value="services" className="pt-2">
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
          </TabsContent>

          {engine.name === 'sing-box' &&
            (['outbounds', 'routing'] as const).map((view) => (
              <TabsContent key={view} value={view} className="pt-2">
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
      </div>

      {/* 3. Floating Sticky Action Bar for Draft Edits */}
      <StickyDraftDock
        dirty={dirty}
        saving={saving}
        targetVersion={draft.version + 1}
        changesCount={draft.services.length}
        onSave={save}
        onDiscard={() => {
          setDraft(engine.draft);
          setDirty(false);
        }}
      />

      {/* 4. Review Changes & Deploy Modal */}
      <ReviewDiffDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        engine={engine}
        services={draft.services}
        session={session}
        online={online}
        canEdit={canEdit}
        saving={saving || dirty}
        onDone={refresh}
        onApplyAction={(key) => engineAction(engine, 'engine.apply', key, session)}
      />

      {/* Credential Rotation Dialog */}
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

      {/* Service Editors */}
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
      ) : selected ? (
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
      ) : null}

      {/* Revealed Connections Dialog */}
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
                <div className="w-fit max-w-full bg-white p-4">
                  <QRCode value={item.url} size={192} title={`${item.name} 客户端连接二维码`} />
                </div>
                <p className="text-text-secondary">
                  {online ? engineStatus(item.runtime_status) : '节点离线，运行状态未确认'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    className="min-h-9"
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
