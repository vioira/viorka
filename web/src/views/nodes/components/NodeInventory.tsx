import { useEffect, useState } from 'react';
import { isStale, percent } from '@/api/monitoring';
import { type NodeRecord, nodeKind, nodeState, nodeTime } from '@/api/nodes';
import DataTable, { type DataColumn } from '@/components/data-table';
import NodeDetails from './NodeDetails';

export default function NodeInventory({
  nodes,
  loaded,
  loading,
}: {
  nodes: NodeRecord[];
  loaded: boolean;
  loading: boolean;
}) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const columns: DataColumn<NodeRecord>[] = [
    { key: 'name', label: '节点', render: (_, node) => <NodeDetails node={node} /> },
    { key: 'kind', label: '类型', render: (_, node) => nodeKind(node.kind) },
    {
      key: 'state',
      label: '连接状态',
      render: (_, node) => (
        <span className={node.state === 'online' ? 'text-success' : 'text-text-secondary'}>
          {nodeState(node.state)}
        </span>
      ),
    },
    {
      key: 'cpu',
      label: 'CPU',
      render: (_, node) => {
        const value = node.monitoring?.latest?.cpu?.usage_percent;
        return (
          <span className="tabular-nums">
            {node.state !== 'online' || isStale(node.monitoring, now) || value === undefined
              ? '未知'
              : `${value.toFixed(1)}%`}
          </span>
        );
      },
    },
    {
      key: 'memory',
      label: '内存',
      render: (_, node) => {
        const m = node.monitoring?.latest?.memory;
        const value = percent(m?.used_bytes, m?.total_bytes);
        return (
          <span className="tabular-nums">
            {node.state !== 'online' || isStale(node.monitoring, now) || value === null
              ? '未知'
              : `${value}%`}
          </span>
        );
      },
    },
    { key: 'os', label: '系统', render: (_, node) => node.os || '尚未上报' },
    { key: 'arch', label: '架构', render: (_, node) => node.arch || '尚未上报' },
    {
      key: 'agent_version',
      label: 'Agent 版本',
      render: (_, node) => node.agent_version || '尚未上报',
    },
    {
      key: 'last_seen_at',
      label: '最后在线',
      render: (_, node) => <span className="tabular-nums">{nodeTime(node.last_seen_at)}</span>,
    },
  ];
  return (
    <div aria-busy={loading}>
      <DataTable
        rows={nodes}
        columns={columns}
        rowKey="id"
        tableClassName="sm:min-w-[1000px]"
        caption="节点资产与连接状态"
        emptyMessage={
          !loaded
            ? loading
              ? '正在读取节点…'
              : '尚未读取节点，请刷新重试'
            : '没有符合条件的节点；请清除筛选，或注册 Agent 后刷新'
        }
      />
    </div>
  );
}
