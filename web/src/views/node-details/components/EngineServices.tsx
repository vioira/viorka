import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import { type EngineRecord, engineNames, installEngine, listEngines } from '@/api/engines';
import { Button } from '@/components/arc/button/button';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { useServerEvent } from '@/hooks/realtime';
import EngineOperation from './EngineOperation';
import EnginePanel from './EnginePanel';
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
    <section className="space-y-6" aria-label="引擎与服务" aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 max-w-full">
          <SegmentedControl
            label="选择引擎"
            value={active}
            onValueChange={setActive}
            options={engineNames.map((name) => {
              const engine = engines?.find((item) => item.name === name);
              return {
                value: name,
                label: name,
                accessory: (
                  <span className="text-(length:--text-xs) tabular-nums">
                    {engines === null
                      ? '未读取'
                      : !engine || engine.status === 'not_installed'
                        ? '未安装'
                        : engine.draft.services.filter((service) => !service.pending_delete).length}
                  </span>
                ),
              };
            })}
          />
        </div>
        <Button
          variant="secondary"
          className="min-h-11"
          disabled={loading}
          onClick={() => void refresh()}
        >
          刷新引擎
        </Button>
      </div>
      <p className="text-text-secondary">
        {online
          ? '安装与执行需要 Agent 提供 Linux/systemd 管理能力。'
          : '节点离线，可编辑已有草稿，不能提交执行操作。'}{' '}
        外部连通尚未验证。
      </p>
      {engines === null ? (
        <p className="min-h-24 text-text-secondary">
          {loading ? '正在读取引擎…' : '引擎状态尚未读取'}
        </p>
      ) : (
        engineNames.map((name) => {
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
                  ? 'flex flex-wrap items-center justify-between gap-4 rounded-(--radius-panel) border-[0.5px] border-border p-6'
                  : 'hidden'
              }
            >
              <h3 className="font-medium">{name}</h3>
              <span className="text-text-secondary">未登记托管实例</span>
              <EngineOperation
                title={`安装 ${name}`}
                description="将下载固定版本并校验摘要。同类第三方实例存在时会拒绝安装；安装后没有服务时保持停止。发行版本仍待实机验收。"
                disabled={!online || session.user.role !== 'admin'}
                run={(key) => installEngine(nodeId, name, key, session)}
                onDone={refresh}
              />
            </div>
          );
        })
      )}
    </section>
  );
}
