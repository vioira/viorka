import { KeyRound, Link2, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
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
import { Button } from '@/components/arc/button/button';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import EngineConnectionsDialog from '@/components/engine-connections';
import EngineConfiguration from './EngineConfiguration';
import EngineOperation from './EngineOperation';
import EnginePipeline from './EnginePipeline';
import EngineRuntime from './EngineRuntime';
import EngineServiceTable from './EngineServiceTable';
import PresetServiceEditor from './PresetServiceEditor';
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
  refresh,
  onSaved,
}: {
  engine: EngineRecord;
  nodeIP: string;
  nodeName: string;
  active: boolean;
  session: Session;
  online: boolean;
  refresh: () => Promise<void>;
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

  const canEdit =
    !engine.reenrollment_check &&
    session.user.role !== 'viewer' &&
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
  const editingService =
    selected !== null && draft.services.some((item) => item.id === selected.id);

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
          onRefresh={refresh}
        />
      </div>

      <EngineConfiguration
        draft={draft}
        active={active}
        engineName={engine.name}
        serviceEditorOpen={selected !== null}
        disabled={!canEdit || saving}
        onRoutingChange={(routing) => {
          setDraft((current) => ({ ...current, routing }));
          setDirty(true);
        }}
        services={
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {engine.name !== 'sing-box' && (
                <h3 className="text-(length:--text-sm) font-medium">
                  {realm ? 'TCP 转发规则' : '代理服务'}
                </h3>
              )}
              <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                {!realm && (
                  <Button
                    variant="ghost"
                    disabled={engine.observed_revision === 0 || revealing}
                    onClick={(event) => void reveal(event.currentTarget)}
                  >
                    <Link2 size={16} strokeWidth={1.75} aria-hidden="true" />
                    全部连接信息
                  </Button>
                )}
                <Button
                  ref={addServiceTrigger}
                  variant="secondary"
                  disabled={!canEdit || saving || draft.services.length >= 32}
                  onClick={(event) =>
                    editService(newService(engine.name, nodeIP), event.currentTarget)
                  }
                >
                  <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
                  {realm ? '添加转发规则' : '添加服务'}
                </Button>
              </div>
            </div>
            <EngineServiceTable
              services={draft.services}
              realm={realm}
              disabled={!canEdit || saving}
              canReveal={engine.observed_revision > 0 && !revealing}
              canRotate={online && canEdit && !dirty && !saving}
              onRotate={(service, trigger) => {
                rotationFocus.current = trigger;
                setRotating(service);
              }}
              onUpdate={update}
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
            return refresh();
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

      {/* Revealed Connections Dialog */}
      <EngineConnectionsDialog
        connections={connections}
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
              return refresh();
            }}
          />
        )}
      />
    </section>
  );
}
