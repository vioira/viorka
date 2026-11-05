import NodeSummaryTable from '@/components/node-summary-table';
import type { OverviewNode } from '../mock-data';

export default function NodeTable({ nodes }: { nodes: OverviewNode[] }) {
  return <NodeSummaryTable nodes={nodes} caption="节点资源与运行状态（演示数据）" />;
}
