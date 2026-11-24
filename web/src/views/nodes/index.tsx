import { ListFilter, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import { nodeKind } from '@/api/nodes';
import { Button } from '@/components/arc/button/button';
import { SearchField } from '@/components/arc/search-field/search-field';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { Select } from '@/components/arc/select/select';
import Classification from '@/components/node-classification';
import NodeInventory from '@/components/node-inventory';
import { GenerateEnrollment } from '@/components/registration/RegistrationDialogs';
import { useNodes } from '@/hooks/use-nodes';
import RegistrationTokens from './components/RegistrationTokens';

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
  const [group, setGroup] = useState('all'),
    [tag, setTag] = useState('all');
  const categories = [
    ...new Map(
      data.nodes.flatMap((n) => (n.categories ?? []).map((c) => [c.id, c] as const)),
    ).values(),
  ];
  const search = query.trim().toLocaleLowerCase();
  const nodes = data.nodes.filter(
    (node) =>
      (group === 'all' ||
        (group === 'none'
          ? !node.categories?.some((c) => c.kind === 'group')
          : node.categories?.some((c) => c.id === group))) &&
      (tag === 'all' || node.categories?.some((c) => c.id === tag)) &&
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
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 basis-full flex-wrap items-center gap-3 lg:basis-128">
          <SegmentedControl
            label="筛选节点"
            value={filter}
            onValueChange={setFilter}
            options={filters}
          />
          <Select
            label="分组筛选"
            value={group}
            onValueChange={setGroup}
            options={[
              { value: 'all', label: '全部分组' },
              { value: 'none', label: '未分组' },
              ...categories
                .filter((c) => c.kind === 'group')
                .map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <Select
            label="标签筛选"
            value={tag}
            onValueChange={setTag}
            options={[
              { value: 'all', label: '全部标签' },
              ...categories
                .filter((c) => c.kind === 'tag')
                .map((c) => ({ value: c.id, label: c.name })),
            ]}
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
          {(query || group !== 'all' || tag !== 'all' || filter !== 'all') && (
            <Button
              variant="secondary"
              onClick={() => {
                setQuery('');
                setGroup('all');
                setTag('all');
                setFilter('all');
              }}
            >
              <ListFilter size={16} aria-hidden="true" />
              清除筛选
            </Button>
          )}
        </div>
        <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
          <Button
            loading={data.loading}
            variant="secondary"
            disabled={data.loading}
            onClick={() => void data.refresh()}
          >
            <RefreshCw size={16} aria-hidden="true" />
            刷新节点
          </Button>
          {admin && (
            <Classification session={session} nodes={nodes} onChange={() => void data.refresh()} />
          )}
          {admin && <RegistrationTokens session={session} />}
          <GenerateEnrollment
            session={session}
            disabled={!admin}
            triggerLabel="添加节点"
            onCreated={data.created}
            onViewNodes={() => {
              setQuery('');
              setGroup('all');
              setTag('all');
              setFilter('all');
            }}
          />
        </div>
      </div>
      <NodeInventory
        nodes={nodes}
        loaded={data.loaded}
        loading={data.loading}
        emptyMessage={
          query || group !== 'all' || tag !== 'all' || filter !== 'all'
            ? '没有匹配的节点'
            : '暂无节点'
        }
        emptyState={{
          variant:
            query || group !== 'all' || tag !== 'all' || filter !== 'all' ? 'no-results' : 'empty',
          description:
            query || group !== 'all' || tag !== 'all' || filter !== 'all'
              ? undefined
              : admin
                ? '添加节点后可查看资源与运行状态。'
                : '请联系管理员添加节点。',
          action:
            query || group !== 'all' || tag !== 'all' || filter !== 'all' ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setQuery('');
                  setGroup('all');
                  setTag('all');
                  setFilter('all');
                }}
              >
                <ListFilter size={16} aria-hidden="true" />
                清除筛选
              </Button>
            ) : undefined,
        }}
      />
    </>
  );
}
