import { ChevronDown, Globe } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { Category } from '@/api/public-status';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import NodeInventory from '@/components/node-inventory';
import type { ListedNode } from '@/hooks/use-nodes';
import { groupNodesByCategory } from '../node-filters';

export default function NodeGroupedList({
  nodes,
  categories,
  loaded,
  loading,
  selectable,
  selectedKeys,
  onSelectionChange,
  onRowClick,
  onFilterByGroup,
  onFilterByTag,
  renderCategoryEditor,
}: {
  nodes: ListedNode[];
  categories: Category[];
  loaded: boolean;
  loading: boolean;
  selectable: boolean;
  selectedKeys: string[];
  onSelectionChange: (keys: string[]) => void;
  onRowClick?: (node: ListedNode) => void;
  onFilterByGroup: (groupId: string) => void;
  onFilterByTag: (tagId: string) => void;
  renderCategoryEditor?: (node: ListedNode) => ReactNode;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const buckets = groupNodesByCategory(nodes, categories);
  const selectedSet = new Set(selectedKeys);

  return (
    <div className="space-y-4">
      {buckets.map((bucket) => {
        const isCollapsed = !!collapsed[bucket.id];
        const onlineCount = bucket.nodes.filter((n) => n.state === 'online').length;
        const bucketIds = bucket.nodes.map((n) => n.id);
        const bucketSelected = bucketIds.filter((id) => selectedSet.has(id));
        const allBucketSelected =
          bucketIds.length > 0 && bucketSelected.length === bucketIds.length;

        return (
          <section
            key={bucket.id}
            aria-label={`分组 ${bucket.name}`}
            className="overflow-hidden rounded-(--radius-surface) border-[1px] border-border bg-surface"
          >
            <div
              className={`flex flex-wrap items-center justify-between gap-2 bg-surface-muted/50 px-4 py-3 ${
                isCollapsed ? '' : 'border-b-[1px] border-border-subtle'
              }`}
            >
              <button
                type="button"
                aria-expanded={!isCollapsed}
                onClick={() => setCollapsed((prev) => ({ ...prev, [bucket.id]: !prev[bucket.id] }))}
                className="flex min-w-0 items-center gap-2 text-left text-(length:--text-sm) font-medium text-foreground"
              >
                <ChevronDown
                  size={16}
                  aria-hidden="true"
                  className={`shrink-0 text-text-secondary transition-transform duration-200 ease-out motion-reduce:transition-none ${
                    isCollapsed ? '-rotate-90' : ''
                  }`}
                />
                <span className="truncate">{bucket.name}</span>
                {bucket.shared && (
                  <Badge tone="success" outline icon={<Globe size={12} aria-hidden="true" />}>
                    公开
                  </Badge>
                )}
                <span className="text-(length:--text-xs) font-normal text-text-secondary tabular-nums">
                  在线 {onlineCount} / {bucket.nodes.length}
                </span>
              </button>

              {selectable && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (allBucketSelected) {
                      const remove = new Set(bucketIds);
                      onSelectionChange(selectedKeys.filter((id) => !remove.has(id)));
                    } else {
                      onSelectionChange([...new Set([...selectedKeys, ...bucketIds])]);
                    }
                  }}
                >
                  {allBucketSelected ? '取消全选该组' : '勾选该组'}
                </Button>
              )}
            </div>

            {!isCollapsed && (
              <div className="p-3 sm:p-4">
                <NodeInventory
                  plain
                  nodes={bucket.nodes}
                  loaded={loaded}
                  loading={loading}
                  selectable={selectable}
                  selectedKeys={bucketSelected}
                  onSelectionChange={(nextBucketKeys) => {
                    const bucketSet = new Set(bucketIds);
                    const outside = selectedKeys.filter((id) => !bucketSet.has(id));
                    onSelectionChange([...outside, ...nextBucketKeys]);
                  }}
                  onRowClick={onRowClick}
                  onFilterByGroup={onFilterByGroup}
                  onFilterByTag={onFilterByTag}
                  renderCategoryEditor={renderCategoryEditor}
                />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
