import { type ReactNode, useEffect, useState } from 'react';
import { isStale } from '@/api/monitoring';
import { nodeKind, nodeRegion, originMigrationLabels } from '@/api/nodes';
import { decimalBytes, decimalPercent } from '@/api/telemetry';
import { billableTraffic } from '@/api/traffic';
import type { EmptyStatesProps } from '@/components/empty-states';
import NodeSummaryTable from '@/components/node-summary-table';
import type { ListedNode } from '@/hooks/use-nodes';
import { nodeCost, nodeExpiry, nodeUptime } from '@/utils/node-assets';
import NodeConnectionStatus from './NodeConnectionStatus';

export default function NodeInventory({
  nodes,
  loaded,
  loading,
  emptyMessage,
  emptyState,
  framed = false,
  plain = false,
  showAll = true,
  selectable = false,
  selectedKeys,
  onSelectionChange,
  onRowClick,
  onFilterByGroup,
  onFilterByTag,
  renderCategoryEditor,
}: {
  nodes: ListedNode[];
  loaded: boolean;
  loading: boolean;
  emptyMessage?: string;
  emptyState?: Omit<EmptyStatesProps, 'title'>;
  framed?: boolean;
  plain?: boolean;
  showAll?: boolean;
  selectable?: boolean;
  selectedKeys?: string[];
  onSelectionChange?: (keys: string[]) => void;
  onRowClick?: (node: ListedNode) => void;
  onFilterByGroup?: (groupId: string) => void;
  onFilterByTag?: (tagId: string) => void;
  renderCategoryEditor?: (node: ListedNode) => ReactNode;
}) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return (
    <NodeSummaryTable
      framed={framed}
      plain={plain}
      loaded={loaded}
      emptyState={emptyState}
      showAll={showAll}
      loading={loading}
      selectable={selectable}
      selectedKeys={selectedKeys}
      onSelectionChange={onSelectionChange}
      onRowClick={
        onRowClick
          ? (summaryNode) => {
              const raw = byId.get(summaryNode.id);
              if (raw) onRowClick(raw);
            }
          : undefined
      }
      onFilterByGroup={onFilterByGroup}
      onFilterByTag={onFilterByTag}
      renderCategoryEditor={
        renderCategoryEditor
          ? (summaryNode) => {
              const raw = byId.get(summaryNode.id);
              return raw ? renderCategoryEditor(raw) : null;
            }
          : undefined
      }
      nodes={nodes.map((node) => {
        const fast = node.monitoring?.telemetry?.fast;
        const summary = node.metricSummary;
        const stale =
          node.state !== 'online' ||
          (summary ? now >= Date.parse(summary.expires_at) : isStale(node.monitoring, now));
        return {
          id: node.id,
          name: node.name,
          group: node.categories?.find((c) => c.kind === 'group') ?? null,
          tags: node.categories?.filter((c) => c.kind === 'tag') ?? [],
          href: `/nodes/${encodeURIComponent(node.id)}`,
          countryCode: node.location?.country_code,
          os: node.inventory?.os_name || node.os,
          region: nodeRegion(node.location),
          kind: nodeKind(node.kind),
          state: node.state,
          uptime: nodeUptime(node, now),
          cost: nodeCost(node.billing),
          expiry: nodeExpiry(node.billing, now),
          expiryDate: nodeExpiry(node.billing, now, true),
          migrationLabel: node.origin_migration && originMigrationLabels[node.origin_migration],
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
      emptyMessage={emptyMessage ?? '暂无节点'}
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
  const settings = telemetry?.settings?.traffic;
  const mode = summary?.traffic_billing_mode ?? settings?.billing_mode;
  const used = daily && mode ? billableTraffic(daily.rx_bytes, daily.tx_bytes, mode) : undefined;
  const quota = BigInt(settings?.quota_bytes ?? '0');
  return {
    traffic: daily ? Number(BigInt(daily.rx_bytes) + BigInt(daily.tx_bytes)) / 1e9 : null,
    trafficUnlimited: telemetry?.settings !== undefined && quota === 0n,
    trafficQuotaPercent:
      used !== undefined && quota > 0n ? Number((used * 1000n + quota / 2n) / quota) / 10 : null,
    trafficUploadLabel: daily ? decimalBytes(daily.tx_bytes) : undefined,
    trafficDownloadLabel: daily ? decimalBytes(daily.rx_bytes) : undefined,
  };
}
