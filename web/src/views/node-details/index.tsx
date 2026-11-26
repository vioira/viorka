import { Folder, Globe, Tags, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useOutletContext, useParams, useSearchParams } from 'react-router';
import type { Session } from '@/api/auth';
import { assignCategories, readCatalog } from '@/api/public-status';
import { telemetryStale } from '@/api/telemetry';
import { Button } from '@/components/arc/button/button';
import { Tabs, TabsContent, TabsTrigger } from '@/components/arc/tabs/tabs';
import { NodeCategoryPopover, useCategoryCatalog } from '@/components/node-classification';
import { PageTabsList } from '@/components/page-tabs';
import { Teleport } from '@/components/teleport';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import type { MetricRange } from '@/views/nodes/components/NodeMetricHistory';
import NodeMonitoring from '@/views/nodes/components/NodeMonitoring';
import TelemetrySettings from '@/views/nodes/components/TelemetrySettings';
import { AgentUpdates } from './components/AgentUpdates';
import EngineServices from './components/EngineServices';
import NodeOverview from './components/NodeOverview';
import NodeSwitcher from './components/NodeSwitcher';
import NodeTasks from './components/NodeTasks';
import RenameNode from './components/RenameNode';
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
  const [metricRange, setMetricRange] = useState<MetricRange>('live');
  const [visited, setVisited] = useState(() => new Set([tab]));
  useEffect(() => {
    setVisited((previous) => new Set([...previous, tab]));
  }, [tab]);
  const view =
    tab === 'metrics'
      ? metricRange === 'live'
        ? 'live'
        : 'history'
      : ['overview', 'settings'].includes(tab)
        ? tab === 'overview'
          ? 'live'
          : tab
        : '';
  const { node, metrics, missing, now, refresh } = useNode(id, view, state?.initialNode);
  const admin = session.user.role === 'admin';
  const catalogState = useCategoryCatalog(Boolean(node && admin && visited.has('settings')));
  const [removingTagId, setRemovingTagId] = useState<string | null>(null);
  const [, reportCategoryError] = useToastFeedback('error', `node-detail-cat-${id}`);
  const [, reportCategorySuccess] = useToastFeedback('success');
  const content = useRef<HTMLDivElement>(null);

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
              range={metricRange}
              onRangeChange={setMetricRange}
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
          <div className="space-y-6">
            {node && (
              <section aria-label="基本信息" data-node-management="" className="v-card space-y-4">
                <h2 className="v-card-title border-b-[1px] border-border pb-3">基本信息</h2>
                <div className="divide-y-[1px] divide-border">
                  <div className="flex flex-wrap items-center justify-between gap-4 py-3 first:pt-0">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="text-(length:--text-sm) font-medium text-foreground">
                        节点名称
                      </div>
                      <p className="wrap-anywhere text-(length:--text-sm) text-text-secondary">
                        {node.name}
                      </p>
                    </div>
                    {admin && (
                      <RenameNode
                        key={node.id}
                        node={node}
                        session={session}
                        onChanged={() => refresh()}
                      />
                    )}
                  </div>
                  {(() => {
                    const group = node.categories?.find((c) => c.kind === 'group');
                    const tags = node.categories?.filter((c) => c.kind === 'tag') ?? [];
                    return (
                      <div className="flex flex-wrap items-center justify-between gap-4 py-3 last:pb-0">
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="text-(length:--text-sm) font-medium text-foreground">
                            分组与标签
                          </div>
                          <dl className="grid gap-y-2 text-(length:--text-sm) sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:items-center sm:gap-x-3">
                            <dt className="text-text-secondary">所属分组</dt>
                            <dd className="min-w-0">
                              {group ? (
                                <span className="inline-flex items-center gap-1.5 rounded-full border-[1px] border-border bg-surface-muted px-2.5 py-0.5 text-(length:--text-xs) font-medium text-foreground">
                                  <Folder
                                    size={12}
                                    className="text-text-muted"
                                    aria-hidden="true"
                                  />
                                  <span>{group.name}</span>
                                  {group.shared && (
                                    <Globe
                                      size={12}
                                      className="text-success"
                                      aria-label="在公开状态页展示"
                                    />
                                  )}
                                </span>
                              ) : (
                                <span className="text-text-muted">未分组</span>
                              )}
                            </dd>
                            <dt
                              className={`text-text-secondary ${tags.length > 0 ? 'sm:self-start sm:pt-0.5' : ''}`}
                            >
                              节点标签
                            </dt>
                            <dd className="min-w-0">
                              {tags.length === 0 ? (
                                <span className="text-text-muted">无标签</span>
                              ) : (
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {tags.map((tag) => (
                                    <span
                                      key={tag.id}
                                      className={`inline-flex items-center gap-1 rounded-full border-[1px] border-border bg-surface-muted py-0.5 pl-2.5 text-(length:--text-xs) text-text-secondary ${admin ? 'pr-1.5' : 'pr-2.5'}`}
                                    >
                                      <span>{tag.name}</span>
                                      {tag.shared && (
                                        <Globe
                                          size={12}
                                          className="text-success"
                                          aria-label="在公开状态页展示"
                                        />
                                      )}
                                      {admin && (
                                        <button
                                          type="button"
                                          disabled={removingTagId === tag.id}
                                          aria-label={`移除标签 ${tag.name}`}
                                          onClick={async () => {
                                            if (removingTagId) return;
                                            setRemovingTagId(tag.id);
                                            reportCategoryError('');
                                            try {
                                              const activeCatalog =
                                                catalogState.catalog ?? (await readCatalog());
                                              await assignCategories(
                                                activeCatalog.revision,
                                                [node.id],
                                                'remove',
                                                tag.id,
                                                session.csrf_token,
                                              );
                                              catalogState.setCatalog({
                                                ...activeCatalog,
                                                revision: activeCatalog.revision + 1,
                                              });
                                              reportCategorySuccess(`已移除标签“${tag.name}”。`);
                                              void refresh(true);
                                              void catalogState.refresh(true);
                                            } catch (cause) {
                                              reportCategoryError(
                                                cause instanceof Error
                                                  ? cause.message
                                                  : '移除标签失败，请重试。',
                                              );
                                            } finally {
                                              setRemovingTagId(null);
                                            }
                                          }}
                                          className="rounded p-0.5 text-text-muted hover:text-foreground disabled:opacity-40"
                                        >
                                          <X size={12} aria-hidden="true" />
                                        </button>
                                      )}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </dd>
                          </dl>
                        </div>
                        {admin && (
                          <NodeCategoryPopover
                            align="end"
                            session={session}
                            node={node}
                            catalog={catalogState.catalog}
                            onCatalogChange={catalogState.setCatalog}
                            onChange={() => {
                              void refresh(true);
                              void catalogState.refresh(true);
                            }}
                            trigger={
                              <Button variant="secondary">
                                <Tags size={16} aria-hidden="true" />
                                调整分组与标签
                              </Button>
                            }
                          />
                        )}
                      </div>
                    );
                  })()}
                </div>
              </section>
            )}
            {node && tab === 'settings' && (
              <AgentUpdates key={id} id={id} name={node.name || id} session={session} />
            )}
            {node && visited.has('settings') && (
              <TelemetrySettings
                key={`telemetry:${id}`}
                active={tab === 'settings'}
                id={id}
                node={node}
                applied={node.monitoring?.telemetry?.settings}
                traffic={traffic}
                negotiated={!!node.monitoring?.telemetry}
                onChanged={() => refresh()}
              />
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
