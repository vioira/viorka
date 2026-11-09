import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import { type EngineRecord, engineNames, installEngine, listEngines } from '@/api/engines';
import { Button } from '@/components/arc/button/button';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { useServerEvent } from '@/hooks/realtime';
import EngineOperation from './EngineOperation';
import EnginePanel from './EnginePanel';
import EngineSidebar from './EngineSidebar';

export default function EngineServices({
  nodeId,
  nodeIP,
  nodeName,
  online,
}: {
  nodeId: string;
  nodeIP: string;
  nodeName: string;
  online: boolean;
}) {
  const session = useOutletContext<Session>();
  const { toast } = useToastStack();
  const [engines, setEngines] = useState<EngineRecord[] | null>(null);
  const [active, setActive] = useState<string>('sing-box');
  const [loading, setLoading] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setLoading(true);
    try {
      const result = await listEngines(nodeId, controller.signal);
      if (!controller.signal.aborted) setEngines(result.items);
    } catch (error) {
      if (!controller.signal.aborted)
        toast({
          id: `engines-${nodeId}`,
          type: 'error',
          title: '未能读取引擎',
          description: error instanceof Error ? error.message : '请刷新引擎列表。',
        });
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [nodeId, toast]);

  useEffect(() => {
    void refresh();
    return () => abort.current?.abort();
  }, [refresh]);

  useServerEvent((event) => {
    if (
      event.type === 'ready' ||
      (event.type === 'change' &&
        (event.change.kind === 'node' || event.change.kind === 'tasks') &&
        (!event.change.node_id || event.change.node_id === nodeId))
    )
      void refresh();
  });

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
              const engine = engines.find((item) => item.name === name);
              return engine ? (
                <div key={engine.id} hidden={active !== name}>
                  <EnginePanel
                    active={active === name}
                    engine={engine}
                    nodeIP={nodeIP}
                    nodeName={nodeName}
                    session={session}
                    online={online}
                    refresh={refresh}
                  />
                </div>
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
