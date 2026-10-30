import { useState } from 'react';
import { useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import { nodeKind } from '@/api/nodes';
import { Button } from '@/components/arc/button/button';
import { SearchField } from '@/components/arc/search-field/search-field';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { GenerateEnrollment } from '@/components/enrollment/EnrollmentDialogs';
import NodeInventory from './components/NodeInventory';
import { useNodes } from './use-nodes';

const filters = [
  { value: 'all', label: '全部' },
  { value: 'online', label: '在线' },
  { value: 'offline', label: '离线' },
  { value: 'nat', label: 'NAT' },
];

export default function NodesPage() {
  const data = useNodes();
  const session = useOutletContext<Session>();
  const admin = session.user.role === 'admin';
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const search = query.trim().toLocaleLowerCase();
  const nodes = data.nodes.filter(
    (node) =>
      (filter === 'all' ||
        (filter === 'nat'
          ? node.kind === 'nat'
          : filter === 'online'
            ? node.state === 'online'
            : node.state === filter)) &&
      `${node.id} ${node.name} ${nodeKind(node.kind)}`.toLocaleLowerCase().includes(search),
  );
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="font-title text-(length:--text-2xl) font-medium">节点</h1>
          </div>
          <p className="mt-2 max-w-prose text-text-secondary">
            管理 VPS、NAT VPS 与中转节点。Agent 主动连接面板，NAT 节点无需入站管理端口。
          </p>
        </div>
        <div className="flex flex-wrap gap-2" aria-describedby="node-data-note">
          <GenerateEnrollment
            session={session}
            disabled={!admin}
            triggerLabel="添加节点"
            onCreated={data.refresh}
            onViewNodes={() => {
              setQuery('');
              setFilter('all');
              void data.refresh();
            }}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <SegmentedControl
          label="筛选节点"
          value={filter}
          onValueChange={setFilter}
          options={filters}
        />
        <div className="w-full sm:w-72">
          <SearchField
            hideLabel
            label="搜索节点"
            placeholder="节点名、ID 或类型"
            value={query}
            onValueChange={setQuery}
          />
        </div>
        <p role="status" className="py-3 text-text-secondary tabular-nums">
          {data.loaded
            ? `${nodes.length} 个匹配节点（已读取 ${data.nodes.length} 个）`
            : '节点数量未知'}
        </p>
        {(query || filter !== 'all') && (
          <Button
            variant="ghost"
            onClick={() => {
              setQuery('');
              setFilter('all');
            }}
          >
            清除筛选
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={data.loading} onClick={() => void data.refresh()}>
          {data.loading ? '正在读取…' : '刷新节点'}
        </Button>
        {data.hasMore && (
          <Button variant="secondary" disabled={data.loading} onClick={() => void data.loadMore()}>
            加载更多节点
          </Button>
        )}
      </div>
      <NodeInventory nodes={nodes} loaded={data.loaded} loading={data.loading} />
      <p id="node-data-note" className="text-(length:--text-xs) text-text-secondary">
        点击节点名称查看详情；筛选和排序仅针对已读取节点。生成令牌后节点立即出现在列表中，Agent
        注册并启动后可刷新查看连接状态。
        {!admin && ' 仅管理员可添加节点和生成注册令牌。'}
      </p>
    </>
  );
}
