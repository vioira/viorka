import { ArrowRight, RefreshCw } from 'lucide-react';
import { engineNames, engineRuntimeStatus } from '@/api/engines';
import { type NodeRecord, nodeKind, nodeState, nodeTime } from '@/api/nodes';
import { telemetryStale } from '@/api/telemetry';
import { Button } from '@/components/arc/button/button';
import { StatusIndicator } from '@/components/node-status';
import { MetricPlot } from '@/views/nodes/components/MetricTrend';
import { metricCharts } from '@/views/nodes/components/metric-chart';
import TCPProbeQuality from '@/views/nodes/components/TCPProbeQuality';
import { useOverviewData } from '../use-overview-data';
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
  const { history, engines, forbidden, refresh } = useOverviewData(
    node?.id ?? '',
    node?.monitoring?.telemetry?.fast?.sampled_at,
  );
  const telemetry = node?.monitoring?.telemetry;
  const control = node?.monitoring?.telemetry_control;
  const stale = !telemetry || telemetryStale(telemetry, 'fast', now, control);
  const fields = [
    ['节点类型', node ? nodeKind(node.kind) : '未知'],
    ['系统', node?.inventory?.os_name || node?.os || '尚未上报'],
    ['架构', node?.arch || '尚未上报'],
    ['Agent 版本', node?.agent_version || '尚未上报'],
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
                  ? (engine.published_draft?.services.filter(
                      (service) => service.enabled && !service.pending_delete,
                    ).length ?? 0)
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
            {stale ? '等待采样' : `更新于 ${time(telemetry?.fast?.sampled_at ?? '')}`}
          </span>
          <Button
            variant="ghost"
            aria-label="刷新概览"
            onClick={() => {
              refresh();
              return onRefresh();
            }}
          >
            <RefreshCw size={16} aria-hidden="true" />
          </Button>
        </div>
      </div>
      <OverviewResources
        telemetry={telemetry}
        control={control}
        now={now}
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
              realtime
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
              <ul className="grid grid-cols-3 divide-x-[1px] divide-border">
                {engineRows.map((row) => (
                  <li key={row.name} className="min-w-0 space-y-2 px-3 first:pl-0 last:pr-0">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium">{row.name}</span>
                      {row.ownership === 'external' && (
                        <span className="text-(length:--text-xs) text-text-secondary">第三方</span>
                      )}
                    </div>
                    <div className="text-(length:--text-xs)">
                      <StatusIndicator text={row.status} className={row.color} />
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
              <p className="text-(length:--text-xs) text-text-secondary">
                {forbidden ? '没有此节点的引擎访问权限' : '引擎尚未读取'}
              </p>
            )}
          </section>
          <section className="v-card" aria-label="节点信息">
            <h2 className="v-card-title">节点信息</h2>
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
