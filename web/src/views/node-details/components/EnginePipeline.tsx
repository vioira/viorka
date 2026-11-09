import type { Session } from '@/api/auth';
import { type EngineRecord, engineSyncError, retryEngineSync } from '@/api/engines';
import { Button } from '@/components/arc/button/button';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';

export interface EnginePipelineProps {
  engine: EngineRecord;
  draftVersion: number;
  session: Session;
  online: boolean;
  canEdit: boolean;
  saving: boolean;
  onReview: () => void;
  onDeploy: () => void;
  onRefresh: () => Promise<void>;
}

export default function EnginePipeline({
  engine,
  draftVersion,
  session,
  online,
  canEdit,
  saving,
  onReview,
  onDeploy,
  onRefresh,
}: EnginePipelineProps) {
  const { toast } = useToastStack();

  const isFailed = engine.sync_state === 'failed';
  const isSyncing = engine.sync_state === 'syncing';
  const isPending =
    engine.desired_revision > engine.observed_revision ||
    draftVersion > engine.desired_revision ||
    engine.sync_state === 'pending';
  const isFullySynced = !isFailed && !isSyncing && !isPending;

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
      {/* 3-Stage Visual Pipeline */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium text-text-muted uppercase tracking-wider mr-1">
          配置生命周期
        </span>

        {/* Stage 1: Draft */}
        <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-(--radius-control) bg-surface border-[1px] border-border tabular-nums">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              draftVersion > engine.desired_revision ? 'bg-warning' : 'bg-success'
            }`}
          />
          <span className="font-medium">草稿 v{draftVersion}</span>
          <span className="text-text-muted">
            {draftVersion > engine.desired_revision ? '(待应用)' : '(已同步)'}
          </span>
        </div>

        {/* Arrow */}
        <span className="text-text-muted select-none">→</span>

        {/* Stage 2: Desired Revision */}
        <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-(--radius-control) bg-surface border-[1px] border-border tabular-nums">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isFailed
                ? 'bg-danger'
                : engine.desired_revision > engine.observed_revision
                  ? 'bg-warning'
                  : 'bg-success'
            }`}
          />
          <span className="font-medium">目标 r{engine.desired_revision}</span>
        </div>

        {/* Arrow */}
        <span className="text-text-muted select-none">→</span>

        {/* Stage 3: Observed Revision */}
        <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-(--radius-control) bg-surface border-[1px] border-border tabular-nums">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isFailed ? 'bg-danger' : isSyncing ? 'bg-warning animate-pulse' : 'bg-success'
            }`}
          />
          <span className="font-medium">
            {isFailed
              ? `节点同步异常 r${engine.observed_revision}`
              : `节点已确认 r${engine.observed_revision}`}
          </span>
        </div>

        {/* Status Badges */}
        {isFailed && (
          <span className="ml-1 px-2 py-0.5 rounded text-danger bg-surface border-[1px] border-danger/30 font-medium">
            {engineSyncError(engine.sync_error ?? '')}
          </span>
        )}

        {isSyncing && (
          <span className="ml-1 px-2 py-0.5 rounded text-warning bg-surface border-[1px] border-warning/30 font-medium">
            配置同步中，等待 Agent 确认
          </span>
        )}

        {!isFailed && !isSyncing && isPending && (
          <span className="ml-1 px-2 py-0.5 rounded text-warning bg-surface border-[1px] border-warning/30 font-medium">
            已保存草稿待发布到节点
          </span>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2 shrink-0">
        {isFailed && (
          <Button
            variant="secondary"
            className="min-h-9 px-2.5 text-(length:--text-xs)"
            disabled={!canEdit || saving}
            onClick={() => void handleRetry()}
          >
            重试同步
          </Button>
        )}

        <Button
          variant="secondary"
          className="min-h-9 px-2.5 text-(length:--text-xs)"
          disabled={!canEdit || saving || engine.status === 'not_installed'}
          onClick={onReview}
        >
          审查变更
        </Button>

        <Button
          variant={isPending ? 'primary' : 'secondary'}
          className="min-h-9 px-3 text-(length:--text-xs)"
          disabled={!online || !canEdit || saving || engine.status === 'not_installed'}
          onClick={onDeploy}
        >
          {isPending ? '发布配置到节点' : '重新应用配置'}
        </Button>
      </div>
    </section>
  );
}
