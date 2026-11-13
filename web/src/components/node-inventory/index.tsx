import { useEffect, useState } from 'react';
import { isStale } from '@/api/monitoring';
import { nodeKind, nodeRegion } from '@/api/nodes';
import { decimalBytes, decimalPercent } from '@/api/telemetry';
import { billableTraffic } from '@/api/traffic';
import NodeSummaryTable from '@/components/node-summary-table';
import type { ListedNode } from '@/hooks/use-nodes';
import NodeConnectionStatus from './NodeConnectionStatus';

export default function NodeInventory({
  nodes,
  loaded,
  loading,
  emptyMessage,
}: {
  nodes: ListedNode[];
  loaded: boolean;
  loading: boolean;
  emptyMessage?: string;
}) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <NodeSummaryTable
      framed={false}
      showAll
      loading={loading}
      nodes={nodes.map((node) => {
        const fast = node.monitoring?.telemetry?.fast;
        const summary = node.metricSummary;
        const stale =
          node.state !== 'online' ||
          (summary ? now >= Date.parse(summary.expires_at) : isStale(node.monitoring, now));
        return {
          id: node.id,
          name: node.name,
          href: `/nodes/${encodeURIComponent(node.id)}`,
          region: nodeRegion(node.location),
          kind: nodeKind(node.kind),
          state: node.state,
          statusContent:
            node.state === 'pending' ? <NodeConnectionStatus node={node} /> : undefined,
          last_seen_at: node.last_seen_at,
          engines: node.engines?.map(
            (engine) =>
              `${({ xray: 'Xray', realm: 'Realm' } as Record<string, string>)[engine.name] ?? engine.name}${engine.version ? ` ${engine.version}` : ''}`,
          ),
          cpu: stale
            ? null
            : summary
              ? summary.cpu
              : fast?.errors.includes('cpu_unavailable')
                ? null
                : (fast?.cpu_percent ?? null),
          memory:
            stale || (!summary && fast?.errors.includes('memory_unavailable'))
              ? null
              : summary
                ? summary.memory
                : decimalPercent(fast?.ram_used, fast?.ram_total),
          ...nodeDailyTraffic(node, now),
        };
      })}
      emptyMessage={
        !loaded
          ? loading
            ? '正在读取节点…'
            : '尚未读取节点，请刷新重试'
          : (emptyMessage ?? '没有符合条件的节点；请清除筛选，或添加节点后刷新')
      }
    />
  );
}

export function nodeDailyTraffic(node: ListedNode, now: number) {
  const summary = node.metricSummary;
  const telemetry = node.monitoring?.telemetry;
  const record = summary ? summary.daily_traffic : telemetry?.daily_traffic;
  const daily =
    record && now >= Date.parse(record.day_start) && now < Date.parse(record.day_end)
      ? record
      : undefined;
  const mode = summary
    ? summary.traffic_billing_mode
    : telemetry?.settings
      ? (telemetry.settings.traffic?.billing_mode ?? 'both')
      : undefined;
  const bytes = daily && mode ? billableTraffic(daily.rx_bytes, daily.tx_bytes, mode) : undefined;
  const expires = summary
    ? summary.traffic_expires_at
      ? Date.parse(summary.traffic_expires_at)
      : 0
    : daily && telemetry?.settings
      ? Date.parse(daily.sampled_at) +
        (telemetry.settings.http_report_seconds + telemetry.settings.collection_seconds + 15) * 1000
      : 0;
  const trafficNote =
    bytes === undefined
      ? undefined
      : [
          node.state !== 'online' || now >= expires ? '数据已过期' : '',
          daily?.quality ? '数据不完整' : '',
        ]
          .filter(Boolean)
          .join('，');

  return {
    traffic: bytes === undefined ? null : Number(bytes) / 1e9,
    trafficLabel: bytes === undefined ? undefined : decimalBytes(bytes.toString()),
    trafficNote,
  };
}
