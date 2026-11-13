import { useEffect, useRef, useState } from 'react';
import { useLocation, useOutletContext, useParams, useSearchParams } from 'react-router';
import type { Session } from '@/api/auth';
import { telemetryStale } from '@/api/telemetry';
import { Tabs, TabsContent, TabsTrigger } from '@/components/arc/tabs/tabs';
import { PageTabsList } from '@/components/page-tabs';
import { Teleport } from '@/components/teleport';
import NodeMonitoring from '@/views/nodes/components/NodeMonitoring';
import TelemetrySettings from '@/views/nodes/components/TelemetrySettings';
import EngineServices from './components/EngineServices';
import NodeOverview from './components/NodeOverview';
import NodeSwitcher from './components/NodeSwitcher';
import NodeTasks from './components/NodeTasks';
import { useNode } from './use-node';

export default function NodeDetailsPage() {
  const { nodeId = '' } = useParams();
  return <NodePage id={nodeId} />;
}

function NodePage({ id }: { id: string }) {
  const session = useOutletContext<Session>();
  const { state } = useLocation();
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab') ?? 'overview';
  const tab = ['overview', 'engines', 'metrics', 'tasks', 'settings'].includes(requested)
    ? requested
    : 'overview';
  const [historyMode, setHistoryMode] = useState(false);
  const [visited, setVisited] = useState(() => new Set([tab]));
  useEffect(() => {
    setVisited((previous) => new Set([...previous, tab]));
  }, [tab]);
  const view =
    tab === 'metrics'
      ? historyMode
        ? 'history'
        : 'live'
      : ['overview', 'settings'].includes(tab)
        ? tab === 'overview'
          ? 'live'
          : tab
        : '';
  const { node, metrics, missing, now, refresh } = useNode(id, view, state?.initialNode);
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    content.current?.focus();
  }, []);

  // Radix can select on both pointer-down and focus before navigation commits.
  const selectedTab = useRef(tab);
  useEffect(() => {
    selectedTab.current = tab;
  }, [tab]);
  const select = (value: string) => {
    if (selectedTab.current === value) return;
    selectedTab.current = value;
    const next = new URLSearchParams(params);
    next.set('tab', value);
    void setParams(next, { replace: true, preventScrollReset: true });
  };

  const publicIP = node?.inventory?.public_ipv4 || node?.inventory?.public_ipv6 || '';
  const telemetry = node?.monitoring?.telemetry;
  const traffic =
    telemetry &&
    !telemetryStale(telemetry, 'fast', now, node?.monitoring?.telemetry_control) &&
    !telemetry.fast?.errors.includes('traffic_unavailable')
      ? telemetry.fast?.traffic
      : undefined;

  return (
    <div ref={content} tabIndex={-1} className="min-w-0">
      <Teleport to="#panel-header">
        <NodeSwitcher node={node} missing={missing} />
      </Teleport>
      <Tabs value={tab} onValueChange={select}>
        <PageTabsList aria-label="节点详情">
          <TabsTrigger value="overview">概览</TabsTrigger>
          <TabsTrigger value="engines" disabled={!node}>
            引擎与服务
          </TabsTrigger>
          {/* <TabsTrigger value="ports" disabled>
            端口映射（未接入）
          </TabsTrigger> */}
          <TabsTrigger value="metrics" disabled={!node}>
            指标
          </TabsTrigger>
          <TabsTrigger value="tasks" disabled={!node}>
            任务
          </TabsTrigger>
          <TabsTrigger value="settings" disabled={!node}>
            设置
          </TabsTrigger>
        </PageTabsList>
        {node && node.state !== 'online' && (
          <div className="mt-4 px-4 py-2 rounded-(--radius-control) border-[1px] border-warning/40 bg-surface-raised text-(length:--text-xs) text-text-secondary">
            当前未确认管理连接在线，指标是否有效取决于各组采样时间。已有代理服务的运行状态需另行确认。
          </div>
        )}

        <TabsContent value="overview">
          <NodeOverview
            key={id}
            node={node}
            now={now}
            onRefresh={() => refresh()}
            onSelectTab={select}
          />
        </TabsContent>
        <TabsContent value="engines" forceMount hidden={tab !== 'engines'}>
          {node && visited.has('engines') && (
            <EngineServices
              key={id}
              visible={tab === 'engines'}
              nodeId={id}
              nodeName={node.name}
              nodeIP={publicIP}
              online={node.state === 'online'}
            />
          )}
        </TabsContent>
        {/* <TabsContent value="ports">端口映射尚未接入。</TabsContent> */}
        <TabsContent value="metrics" forceMount hidden={tab !== 'metrics'}>
          {node && visited.has('metrics') ? (
            <NodeMonitoring
              key={id}
              id={id}
              onHistoryModeChange={setHistoryMode}
              active={tab === 'metrics'}
              snapshot={node.monitoring}
              connectionState={metrics.state}
              onRefresh={() => {
                metrics.refresh();
              }}
            />
          ) : (
            <p className="text-text-secondary">节点尚未读取，请刷新节点。</p>
          )}
        </TabsContent>
        <TabsContent value="tasks">
          {node ? (
            <NodeTasks key={id} id={id} />
          ) : (
            <p className="text-text-secondary">节点尚未读取，请刷新节点。</p>
          )}
        </TabsContent>
        <TabsContent value="settings" forceMount hidden={tab !== 'settings'}>
          {node && visited.has('settings') && (
            <TelemetrySettings
              key={id}
              active={tab === 'settings'}
              id={id}
              node={node}
              applied={node.monitoring?.telemetry?.settings}
              traffic={traffic}
              negotiated={!!node.monitoring?.telemetry}
              onChanged={() => refresh()}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
