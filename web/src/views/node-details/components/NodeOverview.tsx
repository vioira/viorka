import { ArrowRight, Globe, RefreshCw } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { engineNames, engineRuntimeStatus } from '@/api/engines';
import { type NodeRecord, nodeKind, nodeState, nodeTime, originMigrationLabels } from '@/api/nodes';
import { telemetryStale } from '@/api/telemetry';
import { Button } from '@/components/arc/button/button';
import { Tooltip } from '@/components/arc/tooltip/tooltip';
import EmptyStates from '@/components/empty-states';
import { NodeOSLabel } from '@/components/node-os-icon';
import { nodeUptime } from '@/utils/node-assets';
import { MetricPlot } from '@/views/nodes/components/MetricTrend';
import { metricCharts } from '@/views/nodes/components/metric-chart';
import TCPProbeQuality from '@/views/nodes/components/TCPProbeQuality';
import { useOverviewData } from '../use-overview-data';
import OverviewBilling from './OverviewBilling';
import OverviewResources from './OverviewResources';

const [networkChart] = metricCharts().filter((chart) => chart.key === 'network');
const time = (at: string) =>
  new Date(at).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

export default function NodeOverview({
  node,
  now,
  onRefresh,
  onSelectTab,
}: {
  node: NodeRecord | null;
  now: number;
  onRefresh: () => Promise<void>;
  onSelectTab: (tab: string) => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const { history, engines, forbidden, loading, refresh } = useOverviewData(node?.id ?? '');
  const telemetry = node?.monitoring?.telemetry;
  const control = node?.monitoring?.telemetry_control;
  const stale =
    node?.state !== 'online' || !telemetry || telemetryStale(telemetry, 'fast', now, control);
  const sampledAt = telemetry?.fast?.sampled_at;
  const group = node?.categories?.find((c) => c.kind === 'group');
  const tags = node?.categories?.filter((c) => c.kind === 'tag') ?? [];
  const fields: [string, ReactNode][] = [
    ['节点类型', node ? nodeKind(node.kind) : '未知'],
    [
      '所属分组',
      !node ? (
        '尚未读取'
      ) : group ? (
        <span key="group" className="inline-flex items-center gap-1.5">
          <span>{group.name}</span>
          {group.shared && (
            <Globe size={12} className="shrink-0 text-success" aria-label="在公开状态页展示" />
          )}
        </span>
      ) : (
        <span key="group" className="text-text-secondary">
          未分组
        </span>
      ),
    ],
    [
      '节点标签',
      !node ? (
        '尚未读取'
      ) : tags.length > 0 ? (
        <div key="tags" className="flex flex-wrap items-center gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1 rounded-full border-[1px] border-border bg-surface-muted px-2 py-0.5 text-(length:--text-xs) text-text-secondary"
            >
              <span>{tag.name}</span>
              {tag.shared && (
                <Globe size={12} className="shrink-0 text-success" aria-label="在公开状态页展示" />
              )}
            </span>
          ))}
        </div>
      ) : (
        <span key="tags" className="text-text-secondary">
          无标签
        </span>
      ),
    ],
    ['系统', <NodeOSLabel key="os" os={node?.inventory?.os_name || node?.os || ''} />],
    ['系统运行时长', nodeUptime(node, now)],
    ['架构', node?.arch || '尚未上报'],
    ['Agent 版本', node?.agent_version || '尚未上报'],
    ...(node?.origin_migration
      ? [['面板地址迁移', originMigrationLabels[node.origin_migration]] as [string, string]]
      : []),
    ['节点 ID', node?.id ?? '尚未读取'],
    ['最后在线', nodeTime(node?.last_seen_at ?? '')],
  ];
  const engineRows = engines
    ? engineNames.map((name) => {
        const engine = engines.find((item) => item.name === name);
        const online = node?.state === 'online';
        const confirmed =
          engine &&
          online &&
          !engine.reenrollment_check &&
          engine.ownership === 'managed' &&
          engine.last_error !== 'engine_external' &&
          engine.observed_revision === engine.published_revision;
        const count =
          !engine || engine.status === 'not_installed'
            ? 0
            : !confirmed
              ? null
              : engine.status === 'stopped'
                ? 0
                : engine.status === 'running'
                  ? engine.published_enabled_services
                  : null;
        return {
          name,
          status: engine ? engineRuntimeStatus(engine, node?.state === 'online') : '未安装',
          count,
          color:
            engine?.last_error === 'engine_external'
              ? 'text-warning'
              : !online
                ? 'text-text-secondary'
                : engine?.sync_state === 'syncing'
                  ? 'text-warning'
                  : engine?.status === 'running'
                    ? 'text-success'
                    : engine?.status === 'degraded'
                      ? 'text-danger'
                      : 'text-text-secondary',
          ownership: engine?.ownership,
        };
      })
    : [];
  return (
    <div className="node-overview min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 py-1">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <span
            className={`inline-flex items-center gap-2 text-(length:--text-xs) ${node?.state === 'online' ? 'text-success' : 'text-text-secondary'}`}
          >
            <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
            管理连接{node ? nodeState(node.state) : '未知'}
          </span>
          <span className="text-(length:--text-xs) text-text-secondary">
            {node ? nodeKind(node.kind) : ''}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-(length:--text-xs) text-text-secondary">
            {sampledAt
              ? stale
                ? `最近采样 ${nodeTime(sampledAt)}`
                : `更新于 ${time(sampledAt)}`
              : '等待采样'}
          </span>
          <Button
            variant="ghost"
            aria-label="刷新概览"
            loading={loading || refreshing}
            onClick={async () => {
              setRefreshing(true);
              refresh();
              try {
                await onRefresh();
              } finally {
                setRefreshing(false);
              }
            }}
          >
            <RefreshCw size={16} aria-hidden="true" />
          </Button>
        </div>
      </div>
      <OverviewResources
        telemetry={telemetry}
        cpuPoints={history?.points ?? []}
        memoryPoints={history?.points ?? []}
      />

      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <section className="v-card min-w-0 space-y-3" aria-label="网络趋势">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-baseline gap-3">
                <h2 className="v-card-title">网络趋势</h2>
              </div>
            </div>
            <MetricPlot
              chart={networkChart}
              loading={false}
              mode="live"
              data={node?.monitoring?.metric_trends?.network}
            />
          </section>
          {node && (
            <TCPProbeQuality
              key={node.id}
              id={node.id}
              active
              telemetry={telemetry}
              now={now}
              compact
              onDetails={() => onSelectTab('metrics')}
            />
          )}
          <OverviewBilling billing={node?.billing} now={now} />
        </div>
        <div className="min-w-0 space-y-4">
          <section className="v-card min-w-0 space-y-2" aria-label="引擎与服务">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="v-card-title">引擎与服务</h2>
              <Button
                variant="ghost"
                disabled={!node || forbidden}
                onClick={() => onSelectTab('engines')}
              >
                管理引擎
                <ArrowRight size={16} aria-hidden="true" />
              </Button>
            </div>
            {engineRows.length > 0 ? (
              <ul className="grid grid-cols-3 gap-y-1 divide-x-[1px] divide-border">
                {engineRows.map((row) => (
                  <li
                    key={row.name}
                    className="row-span-2 grid min-w-0 grid-rows-subgrid px-3 first:pl-0 last:pr-0"
                  >
                    <div className="flex flex-wrap content-start items-center gap-x-2">
                      <Tooltip content={row.status} openOnClick>
                        <button
                          type="button"
                          className="inline-flex min-h-6 cursor-help items-center gap-2 font-medium"
                          aria-label={`${row.name}，${row.status}`}
                        >
                          <span
                            aria-hidden="true"
                            className={`size-1.5 shrink-0 rounded-full bg-current ${row.color}`}
                          />
                          {row.name}
                        </button>
                      </Tooltip>
                      {row.ownership === 'external' && (
                        <span className="text-(length:--text-xs) text-text-secondary">第三方</span>
                      )}
                    </div>
                    <p className="text-(length:--text-xs) text-text-secondary">
                      <span className="text-(length:--text-base) text-foreground tabular-nums">
                        {row.count ?? '未知'}
                      </span>{' '}
                      运行服务
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyStates
                headingLevel={3}
                variant={forbidden ? 'forbidden' : 'unknown'}
                title={forbidden ? '没有此节点的引擎访问权限' : '引擎尚未读取'}
              />
            )}
          </section>
          <section className="v-card" aria-label="节点信息">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="v-card-title">节点信息</h2>
              <Button variant="ghost" disabled={!node} onClick={() => onSelectTab('settings')}>
                节点设置
                <ArrowRight size={16} aria-hidden="true" />
              </Button>
            </div>
            <dl className="mt-4 divide-y-[1px] divide-border">
              {fields.map(([label, value]) => (
                <div
                  key={label}
                  className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <dt className="text-text-secondary">{label}</dt>
                  <dd className="wrap-anywhere tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="v-card" aria-label="网络地址">
            <h2 className="v-card-title">网络地址</h2>
            <dl className="mt-4 space-y-4">
              {[
                ['公网 IPv4（出口）', node?.inventory?.public_ipv4],
                ['公网 IPv6（出口）', node?.inventory?.public_ipv6],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-text-secondary">{label}</dt>
                  <dd className="mt-1 wrap-anywhere tabular-nums">{value || '未知'}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
