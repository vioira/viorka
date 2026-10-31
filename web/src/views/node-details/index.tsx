import { useEffect, useRef, useState } from 'react';
import { Link, useOutletContext, useParams, useSearchParams } from 'react-router';
import type { Session } from '@/api/auth';
import { nodeKind, nodeState, nodeTime } from '@/api/nodes';
import { Button } from '@/components/arc/button/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/arc/tabs/tabs';
import NodeMonitoring from '@/views/nodes/components/NodeMonitoring';
import NodeSettings from '@/views/nodes/components/NodeSettings';
import NodeActions from './components/NodeActions';
import NodeOverview from './components/NodeOverview';
import NodeTasks from './components/NodeTasks';
import { useNode } from './use-node';

export default function NodeDetailsPage() {
  const { nodeId = '' } = useParams();
  return <NodePage key={nodeId} id={nodeId} />;
}

function NodePage({ id }: { id: string }) {
  const { node, loading, missing, now, refresh } = useNode(id);
  const session = useOutletContext<Session>();
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab') ?? 'overview';
  const tab = ['overview', 'metrics', 'tasks', 'settings'].includes(requested)
    ? requested
    : 'overview';
  const [taskVersion, setTaskVersion] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const select = (value: string) => {
    const next = new URLSearchParams(params);
    next.set('tab', value);
    void setParams(next, { replace: true, preventScrollReset: true });
  };
  return (
    <>
      <Link to="/nodes" className="inline-flex min-h-11 items-center text-accent hover:underline">
        返回节点列表
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1
              ref={heading}
              tabIndex={-1}
              className="font-title text-(length:--text-2xl) font-medium wrap-anywhere"
            >
              {node?.name || node?.id || '节点详情'}
            </h1>
            <span className={node?.state === 'online' ? 'text-success' : 'text-text-secondary'}>
              {node ? nodeState(node.state) : missing ? '节点不可用' : '状态未知'}
            </span>
          </div>
          <p className="text-text-secondary wrap-anywhere">
            {node
              ? `${nodeKind(node.kind)} / ${node.inventory?.os_name || node.os || '系统尚未上报'} / ${node.arch || '架构未知'}`
              : loading
                ? '正在读取节点详情…'
                : '节点详情尚未读取'}
          </p>
          <p className="text-(length:--text-xs) text-text-secondary tabular-nums">
            最后在线：{nodeTime(node?.last_seen_at ?? '')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <NodeActions
            node={node}
            session={session}
            onChanged={() => refresh()}
            onTask={() => {
              setTaskVersion((n) => n + 1);
              select('tasks');
            }}
          />
          <Button variant="secondary" disabled={loading} onClick={() => void refresh()}>
            刷新节点
          </Button>
        </div>
      </div>
      {node && node.state !== 'online' && (
        <p className="text-text-secondary">
          当前未确认 Agent 在线，实时指标不可用。已有代理服务的运行状态需另行确认。
        </p>
      )}
      <Tabs value={tab} onValueChange={select}>
        <TabsList aria-label="节点详情">
          <TabsTrigger value="overview">概览</TabsTrigger>
          <TabsTrigger value="engines" disabled>
            引擎与服务（未接入）
          </TabsTrigger>
          <TabsTrigger value="ports" disabled>
            端口映射（未接入）
          </TabsTrigger>
          <TabsTrigger value="metrics" disabled={!node}>
            指标
          </TabsTrigger>
          <TabsTrigger value="tasks" disabled={!node}>
            任务
          </TabsTrigger>
          <TabsTrigger value="settings" disabled={!node}>
            设置
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <NodeOverview node={node} now={now} />
        </TabsContent>
        <TabsContent value="engines">引擎与服务尚未接入。</TabsContent>
        <TabsContent value="ports">端口映射尚未接入。</TabsContent>
        <TabsContent value="metrics">
          {node ? (
            <NodeMonitoring id={id} active={tab === 'metrics'} />
          ) : (
            <p className="text-text-secondary">节点尚未读取，请刷新节点。</p>
          )}
        </TabsContent>
        <TabsContent value="tasks">
          {node ? (
            <NodeTasks key={taskVersion} id={id} />
          ) : (
            <p className="text-text-secondary">节点尚未读取，请刷新节点。</p>
          )}
        </TabsContent>
        <TabsContent value="settings" forceMount hidden={tab !== 'settings'}>
          {node && <NodeSettings id={id} />}
        </TabsContent>
      </Tabs>
    </>
  );
}
