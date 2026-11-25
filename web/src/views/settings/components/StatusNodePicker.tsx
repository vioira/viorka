import { ChevronDown, Globe, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { type NodeRecord, nodeKind, nodeRegion } from '@/api/nodes';
import { Button } from '@/components/arc/button/button';
import { Checkbox } from '@/components/arc/checkbox/checkbox';
import { SearchField } from '@/components/arc/search-field/search-field';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { CountryFlag } from '@/components/country-flag';
import EmptyStates from '@/components/empty-states';
import NodeStatus from '@/components/node-status';
import {
  MAX_PUBLISHED_NODES,
  matchesPoolFilter,
  type PoolFilter,
  splitNodeCategories,
} from './status-publication';

export default function StatusNodePicker({
  nodes,
  selectedIds,
  disabled,
  onToggleNode,
  onAddNodes,
}: {
  nodes: NodeRecord[];
  selectedIds: ReadonlySet<string>;
  disabled: boolean;
  onToggleNode: (node: NodeRecord, checked: boolean) => void;
  onAddNodes: (nodes: NodeRecord[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PoolFilter>('all');
  const [mobileOpen, setMobileOpen] = useState(() => selectedIds.size === 0);

  const filteredNodes = useMemo(
    () => nodes.filter((node) => matchesPoolFilter(node, query, filter, selectedIds)),
    [nodes, query, filter, selectedIds],
  );

  const addableFiltered = useMemo(
    () => filteredNodes.filter((node) => !selectedIds.has(node.id)),
    [filteredNodes, selectedIds],
  );

  const atLimit = selectedIds.size >= MAX_PUBLISHED_NODES;
  const hasFilter = query.trim().length > 0 || filter !== 'all';

  return (
    <section className="v-card space-y-4" aria-label="可选节点">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h3 className="text-(length:--text-base) font-medium text-foreground">可选节点</h3>
          <span className="text-(length:--text-xs) text-text-secondary tabular-nums">
            已选 {selectedIds.size} / {nodes.length} 台
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="lg:hidden!"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((current) => !current)}
        >
          <span>{mobileOpen ? '收起节点库' : '展开选择'}</span>
          <ChevronDown
            size={15}
            aria-hidden="true"
            className={`transition-transform duration-200 ease-out motion-reduce:transition-none ${
              mobileOpen ? 'rotate-180' : ''
            }`}
          />
        </Button>
      </div>

      <div className={mobileOpen ? 'space-y-3' : 'hidden space-y-3 lg:block'}>
        <SearchField
          hideLabel
          label="搜索可选节点"
          placeholder="搜索名称、地区或分组"
          disabled={disabled || nodes.length === 0}
          value={query}
          onValueChange={setQuery}
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <SegmentedControl
            label="节点池筛选"
            value={filter}
            onValueChange={(value) => setFilter(value as PoolFilter)}
            options={[
              { value: 'all', label: '全部' },
              { value: 'unselected', label: '未选' },
              { value: 'online', label: '在线' },
            ]}
          />

          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled || addableFiltered.length === 0 || atLimit}
            onClick={() => onAddNodes(addableFiltered)}
          >
            <Plus size={14} aria-hidden="true" />
            <span>全选</span>
          </Button>
        </div>

        {nodes.length === 0 ? (
          <EmptyStates
            headingLevel={3}
            compact
            variant="empty"
            title="暂无可用节点"
            description="请先在节点管理中添加并注册节点。"
          />
        ) : filteredNodes.length === 0 ? (
          <div className="space-y-3 rounded-(--radius-control) border-[1px] border-border-subtle bg-surface-raised p-6 text-center">
            <p className="text-(length:--text-xs) text-text-secondary">
              {hasFilter ? '没有符合筛选条件的节点。' : '暂无节点。'}
            </p>
            {hasFilter && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setQuery('');
                  setFilter('all');
                }}
              >
                清除筛选
              </Button>
            )}
          </div>
        ) : (
          <ul className="max-h-72 divide-y-[1px] divide-border-subtle overflow-y-auto overscroll-contain rounded-(--radius-control) border-[1px] border-border-subtle bg-surface-raised lg:max-h-[42rem]">
            {filteredNodes.map((node) => {
              const checked = selectedIds.has(node.id);
              const rowDisabled = disabled || (!checked && atLimit);
              const checkboxId = `status-node-pick-${node.id}`;
              const { publicGroup, privateGroup } = splitNodeCategories(node.categories);
              const region = nodeRegion(node.location);
              return (
                <li
                  key={node.id}
                  className={`flex items-start gap-3 px-3 py-2.5 transition-colors duration-150 ${
                    checked ? 'bg-(--accent-subtle)' : 'hover:bg-surface-muted'
                  }`}
                >
                  <div className="pt-0.5">
                    <Checkbox
                      id={checkboxId}
                      checked={checked}
                      disabled={rowDisabled}
                      aria-label={checked ? `取消选择 ${node.name}` : `选择 ${node.name}`}
                      onCheckedChange={(next) => onToggleNode(node, next === true)}
                    />
                  </div>
                  <label
                    htmlFor={checkboxId}
                    className={`min-w-0 flex-1 space-y-1 ${
                      rowDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <CountryFlag code={node.location?.country_code} />
                        <span className="truncate font-medium text-foreground">{node.name}</span>
                      </span>
                      <span className="shrink-0 text-(length:--text-xs)">
                        <NodeStatus state={node.state} showLastSeen={false} />
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-(length:--text-xs) text-text-secondary">
                      <span>{region}</span>
                      <span>{nodeKind(node.kind)}</span>
                      {publicGroup ? (
                        <span className="inline-flex items-center gap-1 text-foreground">
                          <Globe size={11} className="text-text-secondary" aria-hidden="true" />
                          <span>公开分组 {publicGroup.name}</span>
                        </span>
                      ) : privateGroup ? (
                        <span className="text-text-muted">{privateGroup.name}（未公开）</span>
                      ) : null}
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
