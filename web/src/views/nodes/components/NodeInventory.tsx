import { useEffect, useState } from 'react';
import { isStale } from '@/api/monitoring';
import { nodeKind, nodeRegion } from '@/api/nodes';
import { decimalPercent } from '@/api/telemetry';
import NodeSummaryTable from '@/components/node-summary-table';
import type { ListedNode } from '../use-nodes';
import NodeConnectionStatus from './NodeConnectionStatus';

export default function NodeInventory({
  nodes,
  loaded,
  loading,
}: {
  nodes: ListedNode[];
  loaded: boolean;
  loading: boolean;
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
        const stale = node.state !== 'online' || isStale(node.monitoring, now);
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
          engines: node.engines,
          cpu:
            stale || fast?.errors.includes('cpu_unavailable') ? null : (fast?.cpu_percent ?? null),
          memory:
            stale || fast?.errors.includes('memory_unavailable')
              ? null
              : decimalPercent(fast?.ram_used, fast?.ram_total),
          traffic: null,
        };
      })}
      emptyMessage={
        !loaded
          ? loading
            ? '正在读取节点…'
            : '尚未读取节点，请刷新重试'
          : '没有符合条件的节点；请清除筛选，或添加节点后刷新'
      }
    />
  );
}
