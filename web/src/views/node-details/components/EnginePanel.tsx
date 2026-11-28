import { ArrowUpRight, KeyRound, Link2, Plus, Waypoints } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { Session } from '@/api/auth';
import {
  type Connection,
  type EngineDraft,
  type EngineRecord,
  type EngineService,
  engineAction,
  engineConnections,
  saveDraft,
} from '@/api/engines';
import { hasPublishedRelayLanding, type RelayRoute } from '@/api/relays';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { Drawer, DrawerContent, useDrawerItem } from '@/components/arc/drawer/drawer';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import EngineConnectionsDialog from '@/components/engine-connections';
import { needsRelayPublication, summarizeServiceRelays } from '@/components/proxy/relay-meta';
import RelayDiagnostics from '@/views/relay-routes/components/RelayDiagnostics';
import RelayDraftDrawer from '@/views/relay-routes/components/RelayDraftDrawer';
import RelayPublishDialog from '@/views/relay-routes/components/RelayPublishDialog';
import ServiceRelays from '@/views/relay-routes/components/ServiceRelays';
import EngineConfiguration from './EngineConfiguration';
import EngineOperation from './EngineOperation';
import EnginePipeline from './EnginePipeline';
import EngineRuntime from './EngineRuntime';
import EngineServiceTable from './EngineServiceTable';
import PresetServiceEditor from './PresetServiceEditor';
import RealmRelayTable from './RealmRelayTable';
import ReviewDiffDialog from './ReviewDiffDialog';
import ServiceEditor from './ServiceEditor';
import StickyDraftDock from './StickyDraftDock';

function newService(engine: string, nodeIP: string): EngineService {
  const port = engine === 'realm' ? 10080 : 443;
  return {
    id: crypto.randomUUID(),
    name: '',
    enabled: true,
    pending_delete: false,
    listen_host: engine === 'sing-box' ? '::' : '0.0.0.0',
    listen_port: port,
    target_host: '',
    target_port: 443,
    server_name: '',
    public_host: nodeIP,
    public_port: nodeIP ? port : 0,
  };
}

export default function EnginePanel({
  engine,
  nodeIP,
  nodeName,
  active,
  session,
  online,
  relays,
  relaysLoaded,
  relaysLoading,
  refresh,
  onReloadRelays,
  onSaved,
}: {
  engine: EngineRecord;
  nodeIP: string;
  nodeName: string;
  active: boolean;
  session: Session;
  online: boolean;
  relays: RelayRoute[];
  relaysLoaded: boolean;
  relaysLoading: boolean;
  refresh: () => Promise<void>;
  onReloadRelays: () => Promise<void>;
  onSaved: (draft: EngineDraft) => void;
}) {
  const { toast } = useToastStack();
  const [draft, setDraft] = useState<EngineDraft>(engine.draft);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [rotating, setRotating] = useState<EngineService | null>(null);
  const rotationFocus = useRef<HTMLElement | null>(null);
  const [selected, setSelected] = useState<EngineService | null>(null);
  const addServiceTrigger = useRef<HTMLButtonElement>(null);
  const editorFocus = useRef<HTMLElement | null>(null);
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [revealing, setRevealing] = useState(false);
  const locked = useRef(false);
  const revealRequest = useRef(0);
  const revealFocus = useRef<HTMLElement | null>(null);

  // In-place relay workflows for both landing engines (sing-box/xray) and entry engine (realm).
  const [relayDrawerServiceId, setRelayDrawerServiceId] = useState<string | null>(null);
  const [relayDraftContext, setRelayDraftContext] = useState<{
    entryId: string;
    landingEngineId: string;
    landingServiceId: string;
    route?: RelayRoute;
  } | null>(null);
  const [relayReview, setRelayReview] = useState<RelayRoute | null>(null);
  const [relayInspectId, setRelayInspectId] = useState<string | null>(null);
  const relayFocus = useRef<HTMLElement | null>(null);

  const canManage = session.user.role !== 'viewer';
  const canEdit =
    !engine.reenrollment_check &&
    canManage &&
    engine.ownership === 'managed' &&
    engine.status !== 'not_installed' &&
    engine.version !== '' &&
    engine.last_error !== 'engine_external';

  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (!active || !canEdit || params.get('create') !== '1' || draft.services.length >= 32) return;
    editorFocus.current = addServiceTrigger.current;
    setSelected(newService(engine.name, nodeIP));
    const next = new URLSearchParams(params);
    next.delete('create');
    setParams(next, { replace: true });
  }, [active, canEdit, params, setParams, draft.services.length, engine.name, nodeIP]);

  useEffect(() => {
    if (!dirty && engine.draft.version >= draft.version) setDraft(engine.draft);
  }, [engine.draft, dirty, draft.version]);

  useEffect(() => {
    if (!active) {
      setSelected(null);
      setConnections(null);
      setReviewOpen(false);
      setRevealing(false);
      setRelayDrawerServiceId(null);
      setRelayDraftContext(null);
      setRelayReview(null);
      setRelayInspectId(null);
    }
    return () => {
      revealRequest.current += 1;
    };
  }, [active]);

  function update(services: EngineService[]) {
    setDraft((current) => ({ ...current, services }));
    setDirty(true);
  }

  function editService(service: EngineService, trigger: HTMLElement | null) {
    editorFocus.current = trigger ?? addServiceTrigger.current;
    setSelected(service);
  }

  function updateService(service: EngineService) {
    update(
      draft.services.some((item) => item.id === service.id)
        ? draft.services.map((item) => (item.id === service.id ? service : item))
        : [...draft.services, service],
    );
    setSelected(null);
  }

  function returnToService() {
    (editorFocus.current ?? addServiceTrigger.current)?.focus();
  }

  async function save() {
    if (locked.current || !active || !canEdit) return;
    locked.current = true;
    setSaving(true);
    try {
      const saved = await saveDraft(engine.id, draft, session);
      setDraft(saved);
      setDirty(false);
      toast({
        type: 'success',
        title: '草稿已保存',
      });
      onSaved(saved);
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

  async function reveal(trigger: HTMLButtonElement, serviceId?: string) {
    const request = ++revealRequest.current;
    revealFocus.current = trigger;
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
      if (request === revealRequest.current) setRevealing(false);
    }
  }

  const realm = engine.name === 'realm';
  const managedRelayIds = useMemo(
    () => (realm && relaysLoaded ? new Set(relays.map((r) => r.id)) : new Set<string>()),
    [realm, relaysLoaded, relays],
  );
  const manualRealmServices = useMemo(
    () =>
      realm && relaysLoaded
        ? draft.services.filter((s) => !managedRelayIds.has(s.id))
        : draft.services,
    [realm, relaysLoaded, draft.services, managedRelayIds],
  );

  function updateManualRealmServices(nextManual: EngineService[]) {
    if (!realm || !relaysLoaded) {
      update(nextManual);
      return;
    }
    const preservedManaged = draft.services.filter((s) => managedRelayIds.has(s.id));
    update([...preservedManaged, ...nextManual]);
  }

  const editingService =
    selected !== null && draft.services.some((item) => item.id === selected.id);
  const landingRelaySummary = useMemo(
    () => (!realm && relaysLoaded ? summarizeServiceRelays(relays) : null),
    [realm, relaysLoaded, relays],
  );
  const inspectedRelay = useMemo(
    () => (relayInspectId ? (relays.find((r) => r.id === relayInspectId) ?? null) : null),
    [relays, relayInspectId],
  );
  const relayDrawerService = useMemo(
    () =>
      relayDrawerServiceId
        ? (draft.services.find((s) => s.id === relayDrawerServiceId) ?? null)
        : null,
    [draft.services, relayDrawerServiceId],
  );
  const shownRelayService = useDrawerItem(relayDrawerService);

  async function refreshAll() {
    await Promise.all([refresh(), onReloadRelays()]);
  }

  return (
    <section
      className={`min-w-0 space-y-4${active && dirty ? ' pb-32 sm:pb-24' : ''}`}
      aria-label={engine.name}
    >
      {/* 1. Integrated Console Header: Runtime Identity + 3-Stage Pipeline */}
      <div className="v-card overflow-hidden" style={{ padding: 0 }}>
        <EngineRuntime
          engine={engine}
          session={session}
          online={online}
          dirty={dirty || saving}
          canEdit={canEdit}
          refresh={refreshAll}
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
          onRefresh={refreshAll}
        />
      </div>

      {/* 2. Landing Engine Relay Dependency Summary */}
      {!realm && landingRelaySummary && landingRelaySummary.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-(--radius-panel) border-[1px] border-border bg-surface px-4 py-3 text-(length:--text-xs)">
          <div className="flex flex-wrap items-center gap-2.5">
            <Waypoints
              size={15}
              strokeWidth={1.75}
              className="shrink-0 text-text-secondary"
              aria-hidden="true"
            />
            <span className="font-medium text-foreground">
              当前引擎承载 {landingRelaySummary.total} 条中转线路的落地目标
            </span>
            {landingRelaySummary.available > 0 && (
              <Badge size="sm" dot tone="success">
                {landingRelaySummary.available} 可供订阅
              </Badge>
            )}
            {landingRelaySummary.pending > 0 && (
              <Badge size="sm" dot tone="warning">
                {landingRelaySummary.pending} 待确认
              </Badge>
            )}
            {landingRelaySummary.attention > 0 && (
              <Badge size="sm" dot tone="danger">
                {landingRelaySummary.attention} 需处理
              </Badge>
            )}
          </div>
          <Link
            to="/proxy/relays"
            className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
          >
            前往中转线路
            <ArrowUpRight size={14} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        </div>
      )}

      <EngineConfiguration
        draft={draft}
        active={active}
        engineName={engine.name}
        serviceEditorOpen={selected !== null}
        disabled={!canEdit || saving}
        managedRelayCount={realm ? relays.length : 0}
        manualRuleCount={realm ? manualRealmServices.filter((s) => !s.pending_delete).length : 0}
        onRoutingChange={(routing) => {
          setDraft((current) => ({ ...current, routing }));
          setDirty(true);
        }}
        realmRelays={
          realm && relaysLoaded ? (
            <div className="min-w-0 space-y-3 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-(length:--text-xs) text-text-secondary">
                  托管中转线路独立发布并自动执行入口拨号与公网探测，不通过下方手动规则草稿编辑。
                </p>
                {canEdit && (
                  <Button
                    size="sm"
                    disabled={saving || draft.services.length >= 32}
                    onClick={(e) => {
                      relayFocus.current = e.currentTarget;
                      setRelayDraftContext({
                        entryId: engine.id,
                        landingEngineId: '',
                        landingServiceId: '',
                      });
                    }}
                  >
                    <Plus size={15} strokeWidth={1.75} aria-hidden="true" />
                    创建中转线路
                  </Button>
                )}
              </div>
              <RealmRelayTable
                routes={relays}
                loaded={relaysLoaded}
                loading={relaysLoading}
                canManage={canManage}
                disabled={!canEdit || saving || draft.services.length >= 32}
                onCreate={(trigger) => {
                  relayFocus.current = trigger;
                  setRelayDraftContext({
                    entryId: engine.id,
                    landingEngineId: '',
                    landingServiceId: '',
                  });
                }}
                onInspect={(r, trigger) => {
                  relayFocus.current = trigger;
                  setRelayInspectId(r.id);
                }}
                onEdit={(r, trigger) => {
                  relayFocus.current = trigger;
                  setRelayDraftContext({
                    entryId: r.draft.engine_id,
                    landingEngineId: r.draft.landing_engine_id,
                    landingServiceId: r.draft.landing_service_id,
                    route: r,
                  });
                }}
                onPublish={(r, trigger) => {
                  relayFocus.current = trigger;
                  setRelayReview(r);
                }}
              />
            </div>
          ) : undefined
        }
        services={
          <div className="min-w-0 space-y-3 pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {engine.name === 'xray' && (
                <h3 className="text-(length:--text-sm) font-medium">代理服务</h3>
              )}
              {realm && (
                <p className="text-(length:--text-xs) text-text-secondary">
                  {relaysLoaded
                    ? '手动 TCP 转发规则随 Realm 引擎草稿统一保存和发布。'
                    : '中转线路尚未读取，当前展示全部 Realm 转发规则。'}
                </p>
              )}
              <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                {realm && !relaysLoaded && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={relaysLoading}
                    onClick={() => void onReloadRelays()}
                  >
                    重试读取中转
                  </Button>
                )}
                {!realm && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={engine.observed_revision === 0 || revealing}
                    onClick={(event) => void reveal(event.currentTarget)}
                  >
                    <Link2 size={15} strokeWidth={1.75} aria-hidden="true" />
                    全部连接信息
                  </Button>
                )}
                <Button
                  ref={addServiceTrigger}
                  variant="secondary"
                  size="sm"
                  disabled={!canEdit || saving || draft.services.length >= 32}
                  onClick={(event) =>
                    editService(newService(engine.name, nodeIP), event.currentTarget)
                  }
                >
                  <Plus size={15} strokeWidth={1.75} aria-hidden="true" />
                  {realm ? '添加转发规则' : '添加服务'}
                </Button>
              </div>
            </div>
            <EngineServiceTable
              services={realm && relaysLoaded ? manualRealmServices : draft.services}
              managedRelay={(id) => realm && managedRelayIds.has(id)}
              relayOptions={(service) => {
                const serviceRelays = relays.filter(
                  (r) => r.draft.landing_service_id === service.id,
                );
                return {
                  relays: serviceRelays,
                  loaded: relaysLoaded,
                  enabled: canManage && hasPublishedRelayLanding(engine, service.id),
                  onAdd: (trigger) => {
                    relayFocus.current = trigger;
                    setRelayDraftContext({
                      entryId: '',
                      landingEngineId: engine.id,
                      landingServiceId: service.id,
                    });
                  },
                  onInspect: (trigger) => {
                    relayFocus.current = trigger;
                    setRelayDrawerServiceId(service.id);
                  },
                };
              }}
              realm={realm}
              disabled={!canEdit || saving}
              canReveal={engine.observed_revision > 0 && !revealing}
              canRotate={online && canEdit && !dirty && !saving}
              onRotate={(service, trigger) => {
                rotationFocus.current = trigger;
                setRotating(service);
              }}
              onUpdate={realm && relaysLoaded ? updateManualRealmServices : update}
              onEdit={editService}
              onReveal={(id, trigger) => void reveal(trigger, id)}
            />
          </div>
        }
      />

      {/* 3. Floating Sticky Action Bar for Draft Edits */}
      <StickyDraftDock
        dirty={active && dirty}
        saving={saving}
        canSave={canEdit}
        onSave={save}
        onDiscard={() => {
          setDraft(engine.draft);
          setDirty(false);
        }}
      />

      {/* 4. Review Changes & Deploy Modal (with Relay Impact Warning) */}
      <ReviewDiffDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        engine={engine}
        services={draft.services}
        relays={realm ? [] : relays}
        session={session}
        online={online}
        canEdit={canEdit}
        saving={saving || dirty}
        onDone={refreshAll}
        onApplyAction={(key, allowUnreachable) =>
          engineAction(engine, 'engine.apply', key, session, {
            allow_unreachable: allowUnreachable,
          })
        }
      />

      {/* Credential Rotation Dialog */}
      {rotating && (
        <EngineOperation
          title="更换凭证"
          icon={KeyRound}
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
            return refreshAll();
          }}
        />
      )}

      {/* Service Editors */}
      {selected && !realm && (selected.preset_id || !editingService) ? (
        <PresetServiceEditor
          nodeName={nodeName}
          key={selected.id}
          service={selected}
          engine={engine.name}
          editing={editingService}
          returnFocus={returnToService}
          onClose={() => setSelected(null)}
          onSave={updateService}
        />
      ) : selected ? (
        <ServiceEditor
          key={selected.id}
          editing={editingService}
          service={selected}
          engine={engine.name}
          returnFocus={returnToService}
          onClose={() => setSelected(null)}
          onSave={updateService}
        />
      ) : null}

      {/* Landing Service Attached Relays Drawer */}
      <Drawer
        open={!realm && relayDrawerService !== null && relayDraftContext === null}
        onOpenChange={(open) => {
          if (!open) setRelayDrawerServiceId(null);
        }}
      >
        <DrawerContent
          title={shownRelayService?.name ?? '关联中转线路'}
          description={`${nodeName}，${engine.name}`}
          className="[--drawer-size:min(34rem,calc(100vw-var(--space-4)))]"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            relayFocus.current?.focus();
          }}
          footer={
            <Button variant="secondary" onClick={() => setRelayDrawerServiceId(null)}>
              关闭
            </Button>
          }
        >
          {shownRelayService && (
            <ServiceRelays
              key={shownRelayService.id}
              engine={engine.id}
              service={shownRelayService.id}
              canManage={canManage}
              published={hasPublishedRelayLanding(engine, shownRelayService.id)}
              initialRoutes={
                relaysLoaded
                  ? relays.filter((r) => r.draft.landing_service_id === shownRelayService.id)
                  : undefined
              }
              onAddRelay={() =>
                setRelayDraftContext({
                  entryId: '',
                  landingEngineId: engine.id,
                  landingServiceId: shownRelayService.id,
                })
              }
              onPublishRelay={(r) => setRelayReview(r)}
            />
          )}
        </DrawerContent>
      </Drawer>

      {/* Realm Managed Relay Diagnostics Drawer */}
      {realm && (
        <RelayDiagnostics
          route={relayDraftContext ? null : inspectedRelay}
          onClose={() => setRelayInspectId(null)}
          onChange={refreshAll}
          onEdit={(target) => {
            setRelayDraftContext({
              entryId: target.draft.engine_id,
              landingEngineId: target.draft.landing_engine_id,
              landingServiceId: target.draft.landing_service_id,
              route: target,
            });
          }}
          onPublish={(target) => setRelayReview(target)}
          returnFocus={() => relayFocus.current?.focus()}
        />
      )}

      {/* In-place Relay Draft Drawer */}
      {relayDraftContext && (
        <RelayDraftDrawer
          key={
            relayDraftContext.route?.id ??
            `${relayDraftContext.entryId}/${relayDraftContext.landingEngineId}/${relayDraftContext.landingServiceId}`
          }
          initialEntry={relayDraftContext.entryId}
          engine={relayDraftContext.landingEngineId}
          service={relayDraftContext.landingServiceId}
          route={relayDraftContext.route}
          returnFocus={() => relayFocus.current?.focus()}
          onClose={() => setRelayDraftContext(null)}
          onSaved={(saved, shouldReview) => {
            setRelayDraftContext(null);
            if (shouldReview && needsRelayPublication(saved)) setRelayReview(saved);
            if (realm) setRelayInspectId(saved.id);
            void refreshAll();
          }}
        />
      )}

      {/* In-place Relay Publish Dialog */}
      {relayReview && (
        <RelayPublishDialog
          route={relayReview}
          returnFocus={() => relayFocus.current?.focus()}
          onClose={() => setRelayReview(null)}
          onSubmitted={() => {
            setRelayReview(null);
            void refreshAll();
          }}
        />
      )}

      {/* Revealed Connections Dialog */}
      <EngineConnectionsDialog
        connections={connections}
        relays={realm ? [] : relays}
        online={online}
        onClose={() => setConnections(null)}
        returnFocus={revealFocus.current}
        renderActions={(item) => (
          <EngineOperation
            title="更换凭证"
            icon={KeyRound}
            description={`为「${item.name}」生成新凭证，并应用整个已保存的引擎草稿。任务成功后，旧凭证将失效，需要重新分发连接信息。`}
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
              return refreshAll();
            }}
          />
        )}
      />
    </section>
  );
}
