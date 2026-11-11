import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import { ApiError } from '@/api/client';
import {
  type EngineDraft,
  type EngineRecord,
  type EngineSummary,
  engineNames,
  getEngine,
  installEngine,
  listEngines,
} from '@/api/engines';
import { Button } from '@/components/arc/button/button';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { useBrowserSocket, useRealtimeConnection, useServerEvent } from '@/hooks/realtime';
import EngineOperation from './EngineOperation';
import EnginePanel from './EnginePanel';
import EngineSidebar from './EngineSidebar';

export default function EngineServices({
  nodeId,
  nodeIP,
  nodeName,
  online,
  visible = true,
}: {
  nodeId: string;
  nodeIP: string;
  nodeName: string;
  online: boolean;
  visible?: boolean;
}) {
  const session = useOutletContext<Session>();
  const { toast } = useToastStack();
  const [engines, setEngines] = useState<EngineSummary[] | null>(null);
  const [active, setActive] = useState<string>('sing-box');
  const [loading, setLoading] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const connection = useRealtimeConnection();
  const socket = useBrowserSocket();
  const [details, setDetails] = useState<Record<string, EngineRecord>>({});
  const detailRequests = useRef(new Map<string, AbortController>());
  const inFlight = useRef<Promise<void> | null>(null);
  const dirty = useRef(false);
  const patches = useRef(new Map<string, EngineSummary>());
  const refresh = useCallback((): Promise<void> => {
    if (inFlight.current) {
      dirty.current = true;
      return inFlight.current;
    }
    const controller = new AbortController();
    abort.current = controller;
    setLoading(true);
    const pending = (async () => {
      try {
        do {
          dirty.current = false;
          patches.current.clear();
          const result = await listEngines(nodeId, controller.signal);
          if (controller.signal.aborted) return;
          setEngines(result.items.map((item) => patches.current.get(item.id) ?? item));
        } while (dirty.current);
      } catch (error) {
        if (!controller.signal.aborted && error instanceof ApiError && error.status === 403) {
          setEngines(null);
          setDetails({});
        }
        if (!controller.signal.aborted)
          toast({
            id: `engines-${nodeId}`,
            type: 'error',
            title: '未能读取引擎',
            description: error instanceof Error ? error.message : '请刷新引擎列表。',
          });
      } finally {
        if (abort.current === controller) {
          setLoading(false);
          inFlight.current = null;
        }
      }
    })();
    inFlight.current = pending;
    return pending;
  }, [nodeId, toast]);
  const { initialized, enabled, generation } = connection;
  useEffect(() => {
    if (!visible || !initialized) return;
    if (!enabled || generation > 0) {
      void refresh();
      return;
    }
    const timer = setTimeout(() => void refresh(), 3000);
    return () => clearTimeout(timer);
  }, [visible, initialized, enabled, generation, refresh]);
  useEffect(
    () => () => {
      abort.current?.abort();
      inFlight.current = null;
      for (const request of detailRequests.current.values()) request.abort();
      detailRequests.current.clear();
    },
    [],
  );
  const selected = engines?.find((engine) => engine.name === active);
  const cached = selected && details[selected.id];
  useEffect(() => {
    socket.setEngine(visible ? (selected?.id ?? '') : '');
    return () => socket.setEngine('');
  }, [socket, visible, selected?.id]);
  useEffect(() => {
    if (
      !visible ||
      !selected ||
      cached?.draft.version === selected.draft_version ||
      detailRequests.current.has(selected.id)
    )
      return;
    const controller = new AbortController();
    detailRequests.current.set(selected.id, controller);
    void getEngine(selected.id, controller.signal)
      .then((engine) => {
        detailRequests.current.delete(selected.id);
        if (!controller.signal.aborted)
          setDetails((previous) =>
            previous[engine.id]?.draft.version > engine.draft.version
              ? previous
              : { ...previous, [engine.id]: engine },
          );
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          toast({
            id: `engine-${selected.id}`,
            type: 'error',
            title: '未能读取引擎配置',
            description: error instanceof Error ? error.message : '请刷新引擎状态。',
          });
      })
      .finally(() => detailRequests.current.delete(selected.id));
  }, [visible, selected, cached?.draft.version, toast]);
  useServerEvent(
    (event) => {
      if (
        !visible ||
        event.type !== 'change' ||
        event.change.kind !== 'engines' ||
        (event.change.node_id && event.change.node_id !== nodeId)
      )
        return;
      const detail = event.change.engine_detail;
      if (detail) setDetails((previous) => ({ ...previous, [detail.id]: detail }));
      const engine = event.change.engine;
      if (engine) {
        patches.current.set(engine.id, engine);
        setEngines((previous) =>
          previous ? [...previous.filter((item) => item.id !== engine.id), engine] : previous,
        );
      } else void refresh();
    },
    visible ? [{ kind: 'engines', node_id: nodeId }] : [],
  );
  const saved = (id: string, draft: EngineDraft) => {
    setDetails((previous) => ({ ...previous, [id]: { ...previous[id], draft } }));
    setEngines(
      (previous) =>
        previous?.map((item) =>
          item.id === id
            ? {
                ...item,
                draft_version: draft.version,
                service_count: draft.services.filter((service) => !service.pending_delete).length,
              }
            : item,
        ) ?? null,
    );
  };

  return (
    <section className="space-y-4" aria-label="引擎与服务" aria-busy={loading}>
      {engines === null ? (
        <div className="rounded-(--radius-panel) border-[1px] border-border bg-surface p-8 text-center text-text-secondary min-h-36 flex items-center justify-center">
          {loading ? '正在读取引擎…' : '引擎状态尚未读取'}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Left: Engine Navigator Sidebar */}
          <div className="lg:col-span-3 space-y-2.5">
            <EngineSidebar
              engines={engines}
              active={active}
              onSelect={setActive}
              loading={loading}
              online={online}
            />
            <Button
              variant="secondary"
              className="w-full min-h-9 text-(length:--text-xs)"
              disabled={loading}
              onClick={() => void refresh()}
            >
              刷新引擎状态
            </Button>
          </div>

          {/* Right: Selected Engine Workspace */}
          <div className="lg:col-span-9 min-w-0">
            {engineNames.map((name) => {
              const summary = engines.find((item) => item.name === name);
              const cached = summary && details[summary.id];
              const engine = cached && summary ? { ...cached, ...summary } : undefined;
              return engine ? (
                <div key={engine.id} hidden={active !== name}>
                  <EnginePanel
                    active={visible && active === name}
                    engine={engine}
                    nodeIP={nodeIP}
                    nodeName={nodeName}
                    session={session}
                    online={online}
                    refresh={refresh}
                    onSaved={(draft) => saved(engine.id, draft)}
                  />
                </div>
              ) : summary ? (
                <p key={summary.id} hidden={active !== name} className="text-text-secondary">
                  正在读取引擎配置…
                </p>
              ) : (
                <div
                  key={name}
                  hidden={active !== name}
                  className={
                    active === name
                      ? 'rounded-(--radius-panel) border-[1px] border-border bg-surface p-6 space-y-4'
                      : 'hidden'
                  }
                >
                  <div className="flex items-center justify-between border-b-[1px] border-border pb-3">
                    <h3 className="font-medium text-(length:--text-base)">{name}</h3>
                    <span className="text-(length:--text-xs) text-text-muted">未安装</span>
                  </div>

                  <div className="flex flex-col justify-center items-center py-10 space-y-4 text-center">
                    <p className="text-(length:--text-xs) text-text-secondary max-w-md">
                      将下载官方固定版本并校验摘要。同类第三方实例存在时会拒绝安装；安装后没有服务时保持停止。
                    </p>
                    <EngineOperation
                      title={`安装 ${name}`}
                      variant="primary"
                      description={`将为本节点下载并安装 ${name} 托管实例。`}
                      disabled={!online || session.user.role !== 'admin'}
                      run={(key) => installEngine(nodeId, name, key, session)}
                      onDone={refresh}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
