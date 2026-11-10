import { useEffect, useRef, useState } from 'react';
import { Link, useOutletContext, useParams, useSearchParams } from 'react-router';
import type { Session } from '@/api/auth';
import { nodeKind, nodeState, nodeTime } from '@/api/nodes';
import { telemetryStale } from '@/api/telemetry';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/arc/tabs/tabs';
import NodeMonitoring from '@/views/nodes/components/NodeMonitoring';
import TelemetrySettings from '@/views/nodes/components/TelemetrySettings';
import EngineServices from './components/EngineServices';
import NodeOverview from './components/NodeOverview';
import NodeTasks from './components/NodeTasks';
import { useNode } from './use-node';

export default function NodeDetailsPage() {
  const { nodeId = '' } = useParams();
  return <NodePage key={nodeId} id={nodeId} />;
}

function NodePage({ id }: { id: string }) {
  const session = useOutletContext<Session>();
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
        ? tab
        : '';
  const { node, metrics, missing, now, refresh } = useNode(id, view);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
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
    <div className="space-y-4">
      {/* 1. Compact Node Header: Single Row Console Bar */}
      <header className="rounded-(--radius-panel) border-[1px] border-border bg-surface px-4 py-2.5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Left: Back Link, Title, Status, Specs */}
          <div className="flex items-center gap-3 min-w-0 flex-wrap">
            <Link
              to="/nodes"
              className="inline-flex items-center text-(length:--text-xs) text-text-secondary hover:text-text-primary transition-colors shrink-0"
            >
              ← 节点列表
            </Link>
            <div className="h-3.5 w-[1px] bg-border shrink-0" />

            <div className="flex items-center gap-2 min-w-0">
              <h1
                ref={heading}
                tabIndex={-1}
                className="font-medium text-(length:--text-base) tracking-tight truncate outline-none"
              >
                {node?.name || node?.id || '节点详情'}
              </h1>

              <span
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-(length:--text-xs) font-medium border-[1px] shrink-0 ${
                  node?.state === 'online'
                    ? 'bg-surface-raised text-success border-success/30'
                    : 'bg-surface-raised text-text-secondary border-border'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    node?.state === 'online' ? 'bg-success' : 'bg-text-muted'
                  }`}
                />
                {node ? nodeState(node.state) : missing ? '节点不可用' : '状态未知'}
              </span>
            </div>

            {node && (
              <div className="hidden md:flex items-center gap-2 text-(length:--text-xs) text-text-secondary tabular-nums">
                {publicIP && (
                  <span className="px-1.5 py-0.2 rounded bg-surface-raised font-mono text-text-secondary border-[1px] border-border">
                    {publicIP}
                  </span>
                )}
                <span>
                  {nodeKind(node.kind)} / {node.inventory?.os_name || node.os || '系统未上报'} /{' '}
                  {node.arch || '架构未知'}
                </span>
                <span className="text-text-muted">
                  最后在线：{nodeTime(node.last_seen_at ?? '')}
                </span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Offline Alert Notice */}
      {node && node.state !== 'online' && (
        <div className="px-4 py-2 rounded-(--radius-control) border-[1px] border-warning/40 bg-surface-raised text-(length:--text-xs) text-text-secondary">
          当前未确认管理连接在线，指标是否有效取决于各组采样时间。已有代理服务的运行状态需另行确认。
        </div>
      )}

      {/* 2. Main Tabbed Navigation */}
      <Tabs value={tab} onValueChange={select}>
        <TabsList aria-label="节点详情">
          <TabsTrigger value="overview">概览</TabsTrigger>
          <TabsTrigger value="engines" disabled={!node}>
            引擎与服务
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
        <TabsContent value="engines" forceMount hidden={tab !== 'engines'}>
          {node && visited.has('engines') && (
            <EngineServices
              visible={tab === 'engines'}
              nodeId={id}
              nodeName={node.name}
              nodeIP={publicIP}
              online={node.state === 'online'}
            />
          )}
        </TabsContent>
        <TabsContent value="ports">端口映射尚未接入。</TabsContent>
        <TabsContent value="metrics" forceMount hidden={tab !== 'metrics'}>
          {node && visited.has('metrics') ? (
            <NodeMonitoring
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
            <NodeTasks id={id} />
          ) : (
            <p className="text-text-secondary">节点尚未读取，请刷新节点。</p>
          )}
        </TabsContent>
        <TabsContent value="settings" forceMount hidden={tab !== 'settings'}>
          {node && visited.has('settings') && (
            <TelemetrySettings
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
