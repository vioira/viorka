import { KeyRound, Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/arc/button/button';
import { SearchField } from '@/components/arc/search-field/search-field';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import NodeInventory from './components/NodeInventory';
import { mockNodes } from './mock-data';

const filters = [
  { value: 'all', label: '全部' },
  { value: 'online', label: '在线' },
  { value: 'offline', label: '离线' },
  { value: 'nat', label: 'NAT' },
];

export default function NodesPage() {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const search = query.trim().toLocaleLowerCase();
  const nodes = mockNodes.filter(
    (node) =>
      (filter === 'all' ||
        (filter === 'nat'
          ? node.nat
          : filter === 'online'
            ? node.status !== 'offline'
            : node.status === filter)) &&
      `${node.id} ${node.region} ${node.type}`.toLocaleLowerCase().includes(search),
  );
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="font-title text-(length:--text-2xl) font-medium">节点</h1>
            <span className="text-(length:--text-xs) text-text-secondary">演示数据</span>
          </div>
          <p className="mt-2 max-w-prose text-text-secondary">
            管理 VPS、NAT VPS 与中转节点。Agent 主动连接面板，NAT 节点无需入站管理端口。
          </p>
        </div>
        <div className="flex flex-wrap gap-2" aria-describedby="node-mock-note">
          <Button variant="secondary" disabled>
            <KeyRound size={16} aria-hidden="true" />
            生成注册令牌
          </Button>
          <Button disabled>
            <Plus size={16} aria-hidden="true" />
            添加节点
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <SegmentedControl
          className="[--control-height-sm:44px]"
          label="筛选节点"
          value={filter}
          onValueChange={setFilter}
          options={filters}
        />
        <div className="w-full sm:w-72">
          <SearchField
            hideLabel
            label="搜索节点"
            placeholder="节点名、地区或类型"
            value={query}
            onValueChange={setQuery}
          />
        </div>
        <p role="status" className="py-3 text-text-secondary tabular-nums">
          {nodes.length} 个节点
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
      <NodeInventory nodes={nodes} />
      <p id="node-mock-note" className="text-(length:--text-xs) text-text-secondary">
        当前展示 mock
        数据，注册令牌与添加节点尚未接入。点击节点名称可展开资产快照；筛选和排序仅在本地生效。
      </p>
    </>
  );
}
