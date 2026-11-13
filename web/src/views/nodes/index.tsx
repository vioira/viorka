import { useState } from 'react';
import { useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import { nodeKind } from '@/api/nodes';
import { Button } from '@/components/arc/button/button';
import { SearchField } from '@/components/arc/search-field/search-field';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { GenerateEnrollment } from '@/components/enrollment/EnrollmentDialogs';
import NodeInventory from '@/components/node-inventory';
import { useNodes } from '@/hooks/use-nodes';

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
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-1 basis-full flex-wrap items-center gap-3 lg:basis-128">
            <SegmentedControl
              label="筛选节点"
              value={filter}
              onValueChange={setFilter}
              options={filters}
            />
            <div className="w-full sm:w-64">
              <SearchField
                hideLabel
                label="搜索节点"
                placeholder="节点名、ID 或类型"
                value={query}
                onValueChange={setQuery}
              />
            </div>
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
          <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
            <Button variant="secondary" disabled={data.loading} onClick={() => void data.refresh()}>
              {data.loading ? '正在读取…' : '刷新节点'}
            </Button>
            <GenerateEnrollment
              session={session}
              disabled={!admin}
              triggerLabel="添加节点"
              onCreated={data.created}
              onViewNodes={() => {
                setQuery('');
                setFilter('all');
              }}
            />
          </div>
        </div>
        <p role="status" className="text-(length:--text-xs) text-text-secondary tabular-nums">
          {data.loaded
            ? `${nodes.length} 个匹配节点（共 ${data.nodes.length} 个）`
            : '节点数量未知'}
        </p>
      </div>
      <NodeInventory nodes={nodes} loaded={data.loaded} loading={data.loading} />
    </>
  );
}
