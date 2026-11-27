import { Copy, Folder, Globe, Tags, X } from 'lucide-react';
import { useState } from 'react';
import type { Session } from '@/api/auth';
import type { NodeRecord } from '@/api/nodes';
import { assignCategories, readCatalog } from '@/api/public-status';
import { Button } from '@/components/arc/button/button';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { NodeCategoryPopover, type useCategoryCatalog } from '@/components/node-classification';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import RenameNode from './RenameNode';

export default function NodeIdentitySettings({
  node,
  session,
  admin,
  catalogState,
  onChanged,
}: {
  node: NodeRecord;
  session: Session;
  admin: boolean;
  catalogState: ReturnType<typeof useCategoryCatalog>;
  onChanged: () => Promise<void>;
}) {
  const [removingTagId, setRemovingTagId] = useState<string | null>(null);
  const [, reportCategoryError] = useToastFeedback('error', `node-detail-cat-${node.id}`);
  const [, reportCategorySuccess] = useToastFeedback('success');
  const { toast } = useToastStack();

  const group = node.categories?.find((c) => c.kind === 'group');
  const tags = node.categories?.filter((c) => c.kind === 'tag') ?? [];

  async function copyNodeId() {
    try {
      await navigator.clipboard.writeText(node.id);
      toast({
        id: `copy-node-id-${node.id}`,
        type: 'success',
        title: '已复制节点 ID',
      });
    } catch {
      toast({
        id: `copy-node-id-${node.id}`,
        type: 'error',
        title: '复制失败',
        description: '请手动选择并复制节点 ID。',
      });
    }
  }

  return (
    <section aria-labelledby="node-identity-heading" data-node-management="" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="node-identity-heading"
          className="text-(length:--text-base) font-medium text-foreground"
        >
          节点标识与分类
        </h2>
        <span className="text-(length:--text-xs) text-text-secondary">修改后立即生效</span>
      </div>

      <div className="divide-y-[1px] divide-border rounded-(--radius-surface) border-[1px] border-border bg-surface">
        {/* Row 1: Inline Node Name */}
        <div className="p-4 sm:px-5">
          <RenameNode
            key={node.id}
            node={node}
            session={session}
            admin={admin}
            onChanged={onChanged}
          />
        </div>

        {/* Row 2: Group & Tags */}
        <div className="flex flex-wrap items-start justify-between gap-4 p-4 sm:px-5">
          <div className="min-w-0 flex-1 space-y-2.5">
            <div className="text-(length:--text-sm) font-medium text-foreground">分组与标签</div>
            <dl className="grid gap-y-2.5 text-(length:--text-sm) sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:items-center sm:gap-x-3">
              <dt className="text-(length:--text-xs) text-text-secondary">所属分组</dt>
              <dd className="min-w-0">
                {group ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border-[1px] border-border bg-surface-muted px-2.5 py-0.5 text-(length:--text-xs) font-medium text-foreground">
                    <Folder size={12} className="text-text-muted" aria-hidden="true" />
                    <span>{group.name}</span>
                    {group.shared && (
                      <Globe size={12} className="text-success" aria-label="在公开状态页展示" />
                    )}
                  </span>
                ) : (
                  <span className="text-(length:--text-xs) text-text-muted">未分组</span>
                )}
              </dd>
              <dt
                className={`text-(length:--text-xs) text-text-secondary ${tags.length > 0 ? 'sm:self-start sm:pt-1' : ''}`}
              >
                节点标签
              </dt>
              <dd className="min-w-0">
                {tags.length === 0 ? (
                  <span className="text-(length:--text-xs) text-text-muted">无标签</span>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {tags.map((tag) => (
                      <span
                        key={tag.id}
                        className={`inline-flex items-center gap-1 rounded-full border-[1px] border-border bg-surface-muted py-0.5 pl-2.5 text-(length:--text-xs) text-text-secondary ${admin ? 'pr-1.5' : 'pr-2.5'}`}
                      >
                        <span>{tag.name}</span>
                        {tag.shared && (
                          <Globe size={12} className="text-success" aria-label="在公开状态页展示" />
                        )}
                        {admin && (
                          <button
                            type="button"
                            disabled={removingTagId === tag.id}
                            aria-label={`移除标签 ${tag.name}`}
                            onClick={async () => {
                              if (removingTagId) return;
                              setRemovingTagId(tag.id);
                              reportCategoryError('');
                              try {
                                const activeCatalog = catalogState.catalog ?? (await readCatalog());
                                await assignCategories(
                                  activeCatalog.revision,
                                  [node.id],
                                  'remove',
                                  tag.id,
                                  session.csrf_token,
                                );
                                catalogState.setCatalog({
                                  ...activeCatalog,
                                  revision: activeCatalog.revision + 1,
                                });
                                reportCategorySuccess(`已移除标签“${tag.name}”。`);
                                void onChanged();
                                void catalogState.refresh(true);
                              } catch (cause) {
                                reportCategoryError(
                                  cause instanceof Error ? cause.message : '移除标签失败，请重试。',
                                );
                              } finally {
                                setRemovingTagId(null);
                              }
                            }}
                            className="rounded-full p-0.5 text-text-muted hover:text-foreground disabled:opacity-40"
                          >
                            <X size={12} aria-hidden="true" />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </dd>
            </dl>
          </div>
          {admin && (
            <NodeCategoryPopover
              align="end"
              session={session}
              node={node}
              catalog={catalogState.catalog}
              onCatalogChange={catalogState.setCatalog}
              onChange={() => {
                void onChanged();
                void catalogState.refresh(true);
              }}
              trigger={
                <Button variant="secondary" size="sm">
                  <Tags size={14} aria-hidden="true" />
                  调整分组与标签
                </Button>
              }
            />
          )}
        </div>

        {/* Row 3: Read-only Node ID */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 sm:px-5">
          <div className="min-w-0 space-y-0.5">
            <div className="text-(length:--text-sm) font-medium text-foreground">节点 ID</div>
            <div className="wrap-anywhere font-mono text-(length:--text-xs) text-text-secondary tabular-nums">
              {node.id}
            </div>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => void copyNodeId()}>
            <Copy size={14} aria-hidden="true" />
            复制 ID
          </Button>
        </div>
      </div>
    </section>
  );
}
