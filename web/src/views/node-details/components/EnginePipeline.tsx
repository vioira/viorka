import type { Session } from '@/api/auth';
import {
  canOperateEngine,
  type EngineRecord,
  engineSyncError,
  retryEngineSync,
} from '@/api/engines';
import { Button } from '@/components/arc/button/button';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';

export interface EnginePipelineProps {
  engine: EngineRecord;
  draftVersion: number;
  session: Session;
  online: boolean;
  canEdit: boolean;
  saving: boolean;
  dirty?: boolean;
  onReview: () => void;
  onRefresh: () => Promise<void>;
}

export default function EnginePipeline({
  engine,
  draftVersion,
  session,
  online,
  canEdit,
  saving,
  dirty = false,
  onReview,
  onRefresh,
}: EnginePipelineProps) {
  const { toast } = useToastStack();

  const isFailed = engine.sync_state === 'failed';
  const isOwnershipConflict = isFailed && engine.sync_error === 'engine_external';
  const isSyncing = engine.sync_state === 'syncing';
  const isPending = engine.sync_state === 'pending';
  const canDeploy = online && canEdit && !saving && !dirty && canOperateEngine(engine);

  async function handleRetry() {
    try {
      await retryEngineSync(engine.id, session);
      toast({
        id: `sync-${engine.id}`,
        type: 'success',
        title: '已请求重新同步',
        description: online ? '等待 Agent 应用最新目标配置。' : '节点上线后同步最新目标配置。',
      });
      await onRefresh();
    } catch (error) {
      toast({
        id: `sync-${engine.id}`,
        type: 'error',
        title: '未能重试同步',
        description: error instanceof Error ? error.message : '请核对引擎状态后重试。',
      });
    }
  }

  return (
    <section
      aria-label="发布流水线"
      className="p-3.5 bg-surface-raised flex flex-wrap items-center justify-between gap-3 text-(length:--text-xs) border-t-[1px] border-border"
    >
      <div className="flex items-center gap-2 flex-wrap" aria-live="polite">
        <span className="font-medium text-text-muted mr-1">配置生命周期</span>
        <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-(--radius-control) bg-surface border-[1px] border-border tabular-nums">
          <span
            aria-hidden="true"
            className={`size-1.5 shrink-0 rounded-full ${dirty ? 'bg-warning' : 'bg-success'}`}
          />
          <span className="font-medium">草稿 v{draftVersion}</span>
          <span className="text-text-muted">（{dirty ? '未保存' : '已保存'}）</span>
        </div>
        <span aria-hidden="true" className="text-text-muted select-none">
          →
        </span>
        <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-(--radius-control) bg-surface border-[1px] border-border tabular-nums">
          <span
            aria-hidden="true"
            className={`size-1.5 shrink-0 rounded-full ${isOwnershipConflict ? 'bg-warning' : isFailed ? 'bg-danger' : isSyncing || isPending ? 'bg-warning' : engine.sync_state === 'synced' ? 'bg-success' : 'bg-text-muted'}`}
          />
          <span className="font-medium">最新操作 r{engine.desired_revision}</span>
        </div>
        <span aria-hidden="true" className="text-text-muted select-none">
          →
        </span>
        <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-(--radius-control) bg-surface border-[1px] border-border tabular-nums">
          <span
            aria-hidden="true"
            className={`size-1.5 shrink-0 rounded-full ${isOwnershipConflict ? 'bg-warning' : isFailed ? 'bg-danger' : isSyncing || isPending ? 'bg-warning' : engine.observed_revision > 0 ? 'bg-success' : 'bg-text-muted'}`}
          />
          <span className="font-medium">
            {engine.observed_revision > 0
              ? `节点已确认 r${engine.observed_revision}`
              : '节点尚未确认'}
          </span>
        </div>
        <span
          className={`ml-1 px-2 py-0.5 rounded bg-surface border-[1px] font-medium ${isOwnershipConflict ? 'text-warning border-warning' : isFailed ? 'text-danger border-danger' : isSyncing || isPending ? 'text-warning border-warning' : 'text-text-secondary border-border'}`}
        >
          {isFailed
            ? engineSyncError(engine.sync_error ?? '')
            : isSyncing
              ? '引擎任务执行中'
              : isPending
                ? '目标配置待节点应用'
                : engine.sync_state === 'synced'
                  ? '已发布目标已确认'
                  : engine.sync_state === 'unpublished'
                    ? '尚未发布配置'
                    : '配置发布状态待确认'}
        </span>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2 shrink-0">
        {isFailed && (
          <Button
            variant="secondary"
            className="min-h-9 px-2.5 text-(length:--text-xs)"
            disabled={!canDeploy}
            onClick={() => void handleRetry()}
          >
            重试同步
          </Button>
        )}

        <Button
          variant={isPending ? 'primary' : 'secondary'}
          className="min-h-9 px-3 text-(length:--text-xs)"
          disabled={!canDeploy}
          onClick={onReview}
        >
          审查并发布
        </Button>
      </div>
    </section>
  );
}
