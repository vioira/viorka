import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router';
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
import EmptyStates from '@/components/empty-states';
import { useBrowserSocket, useRealtimeConnection, useServerEvent } from '@/hooks/realtime';
import { useRelays } from '@/views/relay-routes/components/use-relays';
import EngineOperation from './EngineOperation';
import EnginePanel from './EnginePanel';
import EngineRecovery from './EngineRecovery';
import EngineSidebar from './EngineSidebar';

export default function EngineServices({
  nodeId,
  publicHost,
  nodeName,
  online,
  visible = true,
}: {
  nodeId: string;
  publicHost: string;
  nodeName: string;
  online: boolean;
  visible?: boolean;
}) {
  const session = useOutletContext<Session>();
  const { toast } = useToastStack();
  const [engines, setEngines] = useState<EngineSummary[] | null>(null);
  const [params, setParams] = useSearchParams();
  const [active, setActive] = useState<string>(
    () => engineNames.find((name) => name === params.get('engine')) ?? 'sing-box',
  );
  const [loading, setLoading] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const {
    data: relayList,
    busy: relaysLoading,
    reload: reloadRelays,
  } = useRelays(undefined, undefined, visible);

  const connection = useRealtimeConnection();
  const socket = useBrowserSocket();
  const [details, setDetails] = useState<Record<string, EngineRecord>>({});
  const detailRequests = useRef(new Map<string, AbortController>());
  const inFlight = useRef<Promise<void> | null>(null);
  const dirty = useRef(false);
  const patches = useRef(new Map<string, EngineSummary>());

  // Keep active engine in sync if URL query changes externally (e.g. clicking link from Relays).
  const queryEngine = params.get('engine');
  useEffect(() => {
    if (queryEngine && engineNames.includes(queryEngine as (typeof engineNames)[number])) {
      setActive(queryEngine);
    }
  }, [queryEngine]);

  const handleSelectEngine = useCallback(
    (name: string) => {
      setActive(name);
      const next = new URLSearchParams(params);
      next.set('engine', name);
      setParams(next, { replace: true, preventScrollReset: true });
    },
    [params, setParams],
  );

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
          const selected = result.items.find((item) => item.name === active);
          if (selected) {
            const detail = await getEngine(selected.id, controller.signal);
            if (controller.signal.aborted) return;
            setDetails((previous) =>
              previous[detail.id]?.draft.version > detail.draft.version
                ? previous
                : { ...previous, [detail.id]: detail },
            );
          }
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
  }, [nodeId, active, toast]);

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

  const allRelays = relayList?.items ?? null;

  return (
    <section className="space-y-4" aria-label="引擎与服务" aria-busy={loading}>
      {engines === null ? (
        <div className="flex min-h-36 items-center justify-center rounded-(--radius-panel) border-[1px] border-border bg-surface p-8 text-center text-text-secondary">
          {loading ? '正在读取引擎…' : '引擎状态尚未读取'}
        </div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
          {/* Left: Role-Aware Engine Navigator Sidebar */}
          <div className="space-y-2.5 lg:col-span-3">
            <EngineSidebar
              engines={engines}
              relays={allRelays}
              active={active}
              onSelect={handleSelectEngine}
              loading={loading}
              online={online}
            />
            <Button
              loading={loading || relaysLoading}
              variant="secondary"
              className="w-full min-h-9 text-(length:--text-xs)"
              disabled={loading}
              onClick={() => void Promise.all([refresh(), reloadRelays()])}
            >
              <RefreshCw size={16} aria-hidden="true" />
              刷新引擎状态
            </Button>
          </div>

          {/* Right: Selected Engine Workspace */}
          <div className="min-w-0 lg:col-span-9">
            {engineNames.map((name) => {
              const summary = engines.find((item) => item.name === name);
              const cached = summary && details[summary.id];
              const engine = cached && summary ? { ...cached, ...summary } : undefined;
              const engineRelays =
                engine && allRelays
                  ? allRelays.filter((r) =>
                      name === 'realm'
                        ? r.draft.engine_id === engine.id
                        : r.draft.landing_engine_id === engine.id,
                    )
                  : [];

              return engine ? (
                <div key={engine.id} hidden={active !== name}>
                  <EnginePanel
                    active={visible && active === name}
                    engine={engine}
                    publicHost={publicHost}
                    nodeName={nodeName}
                    session={session}
                    online={online}
                    relays={engineRelays}
                    relaysLoaded={allRelays !== null}
                    relaysLoading={relaysLoading}
                    refresh={refresh}
                    onReloadRelays={reloadRelays}
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
                      ? 'space-y-4 rounded-(--radius-panel) border-[1px] border-border bg-surface p-6'
                      : 'hidden'
                  }
                >
                  <div className="flex items-center justify-between border-b-[1px] border-border pb-3">
                    <div className="flex items-center gap-2">
                      <h3 className="text-(length:--text-base) font-medium">{name}</h3>
                      <span className="text-(length:--text-xs) text-text-secondary">
                        {name === 'realm' ? '中转入口引擎' : '代理落地引擎'}
                      </span>
                    </div>
                    <span className="text-(length:--text-xs) text-text-muted">未安装</span>
                  </div>

                  <EmptyStates
                    headingLevel={3}
                    variant="unconfigured"
                    title={`尚未安装 ${name}`}
                    description={
                      session.user.role !== 'admin'
                        ? '需要管理员安装引擎。'
                        : !online
                          ? '节点管理连接恢复在线后可安装引擎。'
                          : name === 'realm'
                            ? '安装后可作为中转入口承载托管中转线路或自定义 TCP 转发规则。'
                            : '安装后可创建并发布代理服务，并可作为中转线路的落地目标。'
                    }
                    action={
                      <div className="flex flex-wrap justify-center gap-2">
                        <EngineOperation
                          title={`安装 ${name}`}
                          variant="primary"
                          description={`将为本节点下载并安装官方固定版本的 ${name} 托管实例，并校验摘要。同类第三方实例存在时会拒绝安装；没有服务时保持停止。`}
                          disabled={!online || session.user.role !== 'admin'}
                          run={(key) => installEngine(nodeId, name, key, session)}
                          onDone={refresh}
                        />
                        {session.user.role === 'admin' && (
                          <EngineRecovery
                            node={nodeId}
                            name={name}
                            session={session}
                            online={online}
                            refresh={refresh}
                          />
                        )}
                      </div>
                    }
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
